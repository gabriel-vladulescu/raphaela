import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { VISIBLE_POST } from '@/lib/posts';
import { slugify } from '@/lib/slug';
import { TAG_COLOR_IDS, TAG_ICON_IDS, tagName } from '../../../tagStyles';

// Tags: words on posts and chapters, besides the category ("full-moon", "relationships"), each with its page
// (/eticheta/{slug}), and maybe a colour and a sign. Their names are lower case, the words joined by dashes
// (tagStyles.ts): writing "Full Moon" makes "full-moon".

export const MAX_TAGS = 10;

export interface Tag {
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
}

/** A colour or a sign, if it's one of those there are (else none). */
export const tagColor = (value: unknown) => ((TAG_COLOR_IDS as readonly unknown[]).includes(value) ? (value as string) : null);
export const tagIcon = (value: unknown) => ((TAG_ICON_IDS as readonly unknown[]).includes(value) ? (value as string) : null);

const toTag = (row: RowDataPacket): Tag => ({
  name: row.name as string,
  slug: row.slug as string,
  color: (row.color as string | null) ?? null,
  icon: (row.icon as string | null) ?? null,
});

/** The tags as written, in their shape ("Full Moon" -> "full-moon"), at most MAX_TAGS, one per slug. */
export function normalizeTags(names: string[]): { name: string; slug: string }[] {
  const seen = new Map<string, { name: string; slug: string }>();
  for (const raw of names) {
    const name = tagName(raw);
    const slug = slugify(name);
    if (!name || slug === 'item' || seen.has(slug)) continue;
    seen.set(slug, { name, slug });
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen.values()];
}

/**
 * A new tag, from the editor's picker, with its colour and sign. One with the same words (the same slug) is there
 * already: that one, as it is (`created` false). Null when the name has nothing left in it.
 */
export async function createTag(db: Pool, input: { name: string; color?: unknown; icon?: unknown }): Promise<{ tag: Tag; created: boolean } | null> {
  const name = tagName(input.name);
  const slug = slugify(name);
  if (!name || slug === 'item') return null;
  const [result] = await db.query<ResultSetHeader>('INSERT IGNORE INTO tags (name, slug, color, icon, created_at) VALUES (?, ?, ?, ?, ?)', [
    name,
    slug,
    tagColor(input.color),
    tagIcon(input.icon),
    new Date(),
  ]);
  const [rows] = await db.query<RowDataPacket[]>('SELECT name, slug, color, icon FROM tags WHERE slug = ?', [slug]);
  return { tag: toTag(rows[0]!), created: result.affectedRows > 0 };
}

/** Gives a post exactly these tags (new ones are created, without a colour or sign; one already there stays as it is). */
export async function setPostTags(db: Pool, postId: number, names: string[]) {
  const tags = normalizeTags(names);
  if (tags.length) {
    await db.query('INSERT IGNORE INTO tags (name, slug, created_at) VALUES ?', [tags.map((t) => [t.name, t.slug, new Date()])]);
  }
  const [rows] = tags.length
    ? await db.query<RowDataPacket[]>('SELECT id FROM tags WHERE slug IN (?)', [tags.map((t) => t.slug)])
    : [[] as RowDataPacket[]];
  const ids = rows.map((row) => row.id as number);
  await db.query(`DELETE FROM post_tags WHERE post_id = ?${ids.length ? ' AND tag_id NOT IN (?)' : ''}`, ids.length ? [postId, ids] : [postId]);
  if (ids.length) await db.query('INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES ?', [ids.map((id) => [postId, id])]);
}

/** Each post's tags, in name order. */
export async function tagsOf(db: Pool, postIds: number[]): Promise<Map<number, Tag[]>> {
  const map = new Map<number, Tag[]>();
  if (postIds.length === 0) return map;
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT pt.post_id, t.name, t.slug, t.color, t.icon FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id IN (?) ORDER BY t.name',
    [postIds],
  );
  for (const row of rows) {
    const list = map.get(row.post_id as number) ?? [];
    list.push(toTag(row));
    map.set(row.post_id as number, list);
  }
  return map;
}

/**
 * Tags with their public posts, most used first. `q`: those whose name has it; `all`: those without public posts too
 * (the editor's picker: a writer's new ones, those on drafts).
 */
export async function popularTags(db: Pool, q: string | undefined, limit: number, all = false) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT t.name, t.slug, t.color, t.icon, COUNT(p.id) AS posts
       FROM tags t
       LEFT JOIN post_tags pt ON pt.tag_id = t.id
       LEFT JOIN posts p ON p.id = pt.post_id AND ${VISIBLE_POST}
      ${q ? 'WHERE t.name LIKE ? OR t.slug LIKE ?' : ''}
      GROUP BY t.id, t.name, t.slug, t.color, t.icon
      ${q || all ? '' : 'HAVING posts > 0'}
      ORDER BY posts DESC, t.name
      LIMIT ?`,
    q ? [`%${q}%`, `%${slugify(q)}%`, limit] : [limit],
  );
  return rows.map((row) => ({ ...toTag(row), posts: Number(row.posts) }));
}

/** One tag, by its slug (its page). */
export async function findTag(db: Pool, slug: string): Promise<Tag | null> {
  const [rows] = await db.execute<RowDataPacket[]>('SELECT name, slug, color, icon FROM tags WHERE slug = ?', [slug]);
  return rows[0] ? toTag(rows[0]) : null;
}
