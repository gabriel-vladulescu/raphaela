// Mock content for development.
//   npm run seed        -> (re)creates seed accounts, categories, posts, likes, bookmarks and comments
//   npm run seed:clear  -> removes everything the seed created (tracked in the seed_records table)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '@/config';
import { connectDb } from '@/db';
import { loadCategoryIndex } from '@/lib/categories';
import { insertComment as storeComment } from '@/lib/comments';
import type { ParentComment } from '@/lib/comments';
import { hashPassword } from '@/lib/password';
import { htmlToText, makeExcerpt, readingMinutes, sanitizePostHtml } from '@/lib/sanitize';
import { uniqueSlug } from '@/lib/slug';
import { bannerSvg, mulberry32 } from '@/seed/banners';
import {
  ACCOUNTS,
  CATEGORIES,
  FOLLOW_UPS,
  MEMBER_COMMENTS,
  MEMBER_REPLIES,
  MERCURY_COMMENTS,
  OWNER_REPLIES,
  POSTS,
  profileOf,
  REACTIONS,
  SEED_PASSWORD,
} from '@/seed/content';
import type { AccountKey, SeedCategory } from '@/seed/content';
import { assignUsername } from '@/lib/usernames';

type SeedTable = 'users' | 'categories' | 'posts';

const EMAIL_DOMAIN = '@seed.local';
const FILE_PREFIX = 'seed-';
const DAY_MS = 86_400_000;

async function ensureRecordsTable(db: Pool) {
  await db.query(`CREATE TABLE IF NOT EXISTS seed_records (
    table_name VARCHAR(32) NOT NULL,
    record_id  INT UNSIGNED NOT NULL,
    PRIMARY KEY (table_name, record_id)
  )`);
}

const track = (db: Pool, table: SeedTable, id: number) =>
  db.execute('INSERT INTO seed_records (table_name, record_id) VALUES (?, ?)', [table, id]);

async function tracked(db: Pool, table: SeedTable): Promise<number[]> {
  const [rows] = await db.execute<RowDataPacket[]>('SELECT record_id FROM seed_records WHERE table_name = ?', [table]);
  return rows.map((row) => row.record_id as number);
}

/** `quiet` skips the summary when there was nothing to remove (used before re-seeding). */
async function clear(db: Pool, quiet = false) {
  await ensureRecordsTable(db);
  const [seedUsers] = await db.execute<RowDataPacket[]>('SELECT id FROM users WHERE email LIKE ?', [`%${EMAIL_DOMAIN}`]);
  const userIds = [...new Set([...(await tracked(db, 'users')), ...seedUsers.map((row) => row.id as number)])];

  // Seed posts, plus anything written while signed in as a seed account.
  const [authored] = userIds.length
    ? await db.query<RowDataPacket[]>('SELECT id FROM posts WHERE author_id IN (?)', [userIds])
    : [[]];
  const postIds = [...new Set([...(await tracked(db, 'posts')), ...authored.map((row) => row.id as number)])];
  if (postIds.length) await db.query('DELETE FROM posts WHERE id IN (?)', [postIds]);

  // Categories deepest-first, so children go before their parents.
  const index = await loadCategoryIndex(db);
  const categoryIds = (await tracked(db, 'categories')).filter(index.exists).sort((a, b) => index.depth(b) - index.depth(a));
  let keptCategories = 0;
  for (const id of categoryIds) {
    try {
      await db.execute('DELETE FROM categories WHERE id = ?', [id]);
    } catch (err) {
      // Someone added their own sub-category under it: keep it rather than lose theirs.
      if ((err as { code?: string }).code !== 'ER_ROW_IS_REFERENCED_2') throw err;
      keptCategories++;
    }
  }

  if (userIds.length) await db.query('DELETE FROM users WHERE id IN (?)', [userIds]);

  let files = 0;
  if (fs.existsSync(config.uploadsDir)) {
    for (const file of fs.readdirSync(config.uploadsDir)) {
      if (!file.startsWith(FILE_PREFIX)) continue;
      fs.rmSync(path.join(config.uploadsDir, file));
      files++;
    }
  }
  // Generated share images are a cache: they're made again when a post is shared.
  fs.rmSync(path.join(config.uploadsDir, 'og'), { recursive: true, force: true });
  await db.query('DROP TABLE seed_records');

  if (!quiet || userIds.length || postIds.length || categoryIds.length || files) {
    console.log(
      `Removed seed data: ${userIds.length} accounts, ${postIds.length} posts, ${categoryIds.length - keptCategories} categories, ${files} banner files.`,
    );
  }
  if (keptCategories) {
    console.log(`Kept ${keptCategories} seed ${keptCategories === 1 ? 'category that now contains' : 'categories that now contain'} your own sub-categories.`);
  }
}

async function seed(db: Pool) {
  await clear(db, true);
  await ensureRecordsTable(db);

  const rand = mulberry32(20261014);
  const now = Date.now();
  const daysAgo = (days: number) => {
    const date = new Date(now - days * DAY_MS);
    date.setMilliseconds(0);
    return date;
  };
  /** A random moment between `from` and now. */
  const after = (from: Date) => new Date(from.getTime() + rand() * (now - from.getTime()));
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)]!;

  // Accounts
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const users = {} as Record<AccountKey, number>;
  for (const account of ACCOUNTS) {
    const { occupation, quote } = profileOf(account);
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO users (email, password_hash, name, name_confirmed, role, occupation, quote, created_at, last_login_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      [account.email, passwordHash, account.name, account.role, occupation, quote, daysAgo(75), daysAgo(1)],
    );
    users[account.key] = result.insertId;
    await assignUsername(db, result.insertId, account.name);
    await track(db, 'users', result.insertId);
  }

  // Categories, after any top-level ones the site already has
  const categories: Record<string, number> = {};
  const insertCategory = async (category: SeedCategory, parentId: number | null, position: number) => {
    const [result] = await db.execute<ResultSetHeader>(
      'INSERT INTO categories (parent_id, name, slug, icon, description, position) VALUES (?, ?, ?, ?, ?, ?)',
      [parentId, category.name, await uniqueSlug(db, 'categories', category.name), category.icon ?? null, category.description ?? null, position],
    );
    categories[category.key] = result.insertId;
    await track(db, 'categories', result.insertId);
    for (const [i, child] of (category.children ?? []).entries()) await insertCategory(child, result.insertId, i + 1);
  };
  const [[top]] = await db.query<RowDataPacket[]>('SELECT COALESCE(MAX(position), 0) AS last FROM categories WHERE parent_id IS NULL');
  for (const [i, category] of CATEGORIES.entries()) await insertCategory(category, null, Number(top.last) + i + 1);

  // Posts (banners are generated SVGs in the uploads folder)
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const visiblePosts: { id: number; publishedAt: Date; title: string }[] = [];
  for (const [i, post] of POSTS.entries()) {
    let bannerUrl: string | null = null;
    if (post.banner) {
      const svg = bannerSvg(post.banner, 1000 + i);
      const file = `${FILE_PREFIX}${i + 1}-${crypto.createHash('sha1').update(svg).digest('hex').slice(0, 8)}.svg`;
      fs.writeFileSync(path.join(config.uploadsDir, file), svg);
      bannerUrl = `/uploads/${file}`;
    }
    const html = sanitizePostHtml(post.html);
    const text = htmlToText(html);
    const status = post.status ?? 'published';
    const publishedAt = status === 'draft' ? null : daysAgo(post.daysAgo);
    const written = daysAgo(Math.max(post.daysAgo, 0) + 0.5);

    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO posts (author_id, category_id, title, slug, excerpt, content_html, content_text, reading_minutes,
                          banner_url, status, published_at, comments_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        users[post.author],
        categories[post.category] ?? null,
        post.title,
        await uniqueSlug(db, 'posts', post.title),
        post.excerpt || makeExcerpt(text),
        html,
        text,
        readingMinutes(text),
        bannerUrl,
        status,
        publishedAt,
        post.commentsOff ? 0 : 1,
        written,
        publishedAt && publishedAt.getTime() < now ? publishedAt : written,
      ],
    );
    await track(db, 'posts', result.insertId);
    if (publishedAt && publishedAt.getTime() <= now) visiblePosts.push({ id: result.insertId, publishedAt, title: post.title });
  }

  // Likes, bookmarks and comments on published posts
  const members = ACCOUNTS.filter((a) => a.role === 'member').map((a) => users[a.key]);
  const writers = ACCOUNTS.filter((a) => a.role !== 'member').map((a) => users[a.key]);
  const seeded: { id: number; userId: number; parentId: number | null; at: Date }[] = [];
  let likes = 0;
  let comments = 0;
  let reactions = 0;
  // Each comment's thread and depth, for the replies to it.
  const threads = new Map<number, ParentComment>();
  const insertComment = async (postId: number, userId: number, body: string, at: Date, parentId: number | null) => {
    const parent = parentId === null ? null : threads.get(parentId)!;
    const id = await storeComment(db, { postId, userId, parent, body, createdAt: at });
    threads.set(id, { id, rootId: parent?.rootId ?? id, depth: parent ? parent.depth + 1 : 0 });
    comments++;
    seeded.push({ id, userId, parentId, at });
    for (const reactor of [...members, ...writers]) {
      if (reactor === userId || rand() >= 0.28) continue;
      await db.execute('INSERT IGNORE INTO comment_reactions (comment_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)', [
        id,
        reactor,
        pick(REACTIONS),
        after(at),
      ]);
      reactions++;
    }
    return id;
  };
  /** A reply, half the time from one of the writers. */
  const insertReply = (postId: number, parent: { id: number; userId: number; at: Date }) => {
    const fromWriter = rand() < 0.5;
    const at = after(parent.at);
    const userId = fromWriter ? pick(writers) : pick(members.filter((m) => m !== parent.userId));
    return insertComment(postId, userId, fromWriter ? pick(OWNER_REPLIES) : pick(MEMBER_REPLIES), at, parent.id).then((id) => ({ id, userId, at }));
  };

  for (const post of visiblePosts) {
    for (const userId of [...members, ...writers]) {
      if (rand() < 0.55) {
        await db.execute("INSERT INTO post_likes (user_id, post_id, liker, created_at) VALUES (?, ?, CONCAT('u', ?), ?)", [
          userId,
          post.id,
          userId,
          after(post.publishedAt),
        ]);
        likes++;
      }
      if (members.includes(userId) && rand() < 0.2) {
        await db.execute('INSERT INTO post_bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)', [userId, post.id, after(post.publishedAt)]);
      }
    }
    // Threads: a comment, a couple of replies (some from the authors), and the odd reply to a reply.
    for (let i = Math.floor(rand() * 4); i > 0; i--) {
      const rootAt = after(post.publishedAt);
      const rootAuthor = pick(members);
      const rootId = await insertComment(post.id, rootAuthor, pick(MEMBER_COMMENTS), rootAt, null);
      for (let j = Math.floor(rand() * 3); j > 0; j--) {
        const reply = await insertReply(post.id, { id: rootId, userId: rootAuthor, at: rootAt });
        if (rand() < 0.4) await insertComment(post.id, rootAuthor, pick(FOLLOW_UPS), after(reply.at), reply.id);
      }
    }
  }

  // One post with a long discussion, to try the paging: 10 threads at a time, and 5 replies at a time.
  const busy = visiblePosts.find((p) => p.title.startsWith('Mercur retrograd'));
  if (busy) {
    for (let i = 0; i < 46; i++) {
      const root = { userId: pick(members), at: after(busy.publishedAt) };
      const rootId = await insertComment(busy.id, root.userId, pick([...MEMBER_COMMENTS, ...MERCURY_COMMENTS]), root.at, null);
      // Every seventh thread is long, and its first reply has a long thread of its own.
      const long = i % 7 === 3;
      const replyCount = long ? 7 + Math.floor(rand() * 8) : Math.floor(rand() * 3);
      for (let j = 0; j < replyCount; j++) {
        const reply = await insertReply(busy.id, { id: rootId, ...root });
        const nested = long && j === 0 ? 6 + Math.floor(rand() * 4) : rand() < 0.2 ? 1 : 0;
        for (let k = 0; k < nested; k++) await insertComment(busy.id, pick(members), pick(FOLLOW_UPS), after(reply.at), reply.id);
      }
    }
  }

  // A few comments were deleted later (with their replies; owners still see them, greyed out): two by the
  // people who wrote them, one removed by an owner. And some were edited.
  const thread = (id: number): number[] => [id, ...seeded.filter((c) => c.parentId === id).flatMap((c) => thread(c.id))];
  const deletedIds = new Set<number>();
  const moderator = users[ACCOUNTS.find((a) => a.role === 'owner')!.key];
  for (const [comment, by] of [
    [pick(seeded.filter((c) => members.includes(c.userId))), null],
    [pick(seeded.filter((c) => members.includes(c.userId) && c.parentId !== null)), null],
    [pick(seeded.filter((c) => c.parentId === null)), moderator],
  ] as const) {
    if (deletedIds.has(comment.id)) continue;
    const ids = thread(comment.id).filter((id) => !deletedIds.has(id));
    await db.query('UPDATE comments SET deleted_at = ?, deleted_by = ? WHERE id IN (?)', [after(comment.at), by ?? comment.userId, ids]);
    for (const id of ids) deletedIds.add(id);
  }
  let edited = 0;
  for (const comment of seeded) {
    if (deletedIds.has(comment.id) || rand() >= 0.1) continue;
    await db.execute('UPDATE comments SET edited_at = ? WHERE id = ?', [after(comment.at), comment.id]);
    edited++;
  }

  const scheduled = POSTS.filter((p) => p.status !== 'draft' && p.daysAgo < 0).length;
  const drafts = POSTS.filter((p) => p.status === 'draft').length;
  console.log(
    `\nSeeded ${ACCOUNTS.length} accounts, ${Object.keys(categories).length} categories, ${POSTS.length} posts ` +
      `(${visiblePosts.length} published, ${scheduled} scheduled, ${drafts} draft), ${likes} likes, ` +
      `${comments} comments (${edited} edited, ${deletedIds.size} deleted), ${reactions} comment reactions.`,
  );
  console.log(`\nSign in with email + password "${SEED_PASSWORD}":`);
  for (const account of ACCOUNTS) console.log(`  ${account.role.padEnd(6)}  ${account.email}`);
  console.log('\nRemove it all with: npm run seed:clear\n');
}

const db = await connectDb(config.db);
try {
  if (process.argv.includes('--clear')) await clear(db);
  else await seed(db);
} finally {
  await db.end();
}
