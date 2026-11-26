import fs from 'node:fs';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import sharp from 'sharp';
import { config } from '@/config';
import { commentLabel, logAdmin } from '@/lib/adminLog';
import { siteDay } from '@/lib/analytics';
import { langOf } from '@/lib/emails';
import { parseId, requireOwner } from '@/lib/guards';
import { sendInvite } from '@/lib/invites';
import { mailConfigured } from '@/lib/mail';
import { notifyComment } from '@/lib/notifications';
import { bookSelect, forgetThought, publicBook, toBook } from '@/lib/books';
import { escapeLike, searchWords } from '@/lib/posts';
import { saveSiteIdentity, site, SOCIAL } from '@/lib/siteIdentity';
import type { SiteIdentity } from '@/lib/siteIdentity';
import { saveSiteSettings, siteSettings } from '@/lib/siteSettings';
import type { SiteSettings } from '@/lib/siteSettings';
import { slugify } from '@/lib/slug';
import { tagColor, tagIcon } from '@/lib/tags';
import { tagName } from '../../../tagStyles';
import { customLogo, setLogo } from '@/seo/brand';

const num = (value: unknown) => Number(value ?? 0);
const paging = {
  offset: { type: 'integer', minimum: 0, default: 0 },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
} as const;
const like = (q: string) => `%${escapeLike(q)}%`;

/** Files in uploads/ that are posts' images (not profile pictures, the logo or generated share images). */
const POST_IMAGE = /^[0-9a-f]{32}\.(webp|jpe?g|png|gif|avif)$/;
/** Images newer than this are never "unused": an editor may be about to save the post that uses them. */
const RECENT_MS = 24 * 60 * 60 * 1000;

/**
 * The admin panel's content tools: featured posts, tags, comments waiting for approval, the newsletter's
 * subscribers, the books, invitations, the media library, what readers search for, and the site's identity and
 * settings.
 */
const adminContentRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;
  app.addHook('onRequest', requireOwner); // before the body is validated

  // ---- Featured posts: at the top of the journal, the latest featured first (articles only: chapters are in their books)

  app.post<{ Params: { id: string }; Body: { featured: boolean } }>(
    '/admin/posts/:id/feature',
    { schema: { body: { type: 'object', required: ['featured'], additionalProperties: false, properties: { featured: { type: 'boolean' } } } } },
    async (req, reply) => {
      const id = parseId(req.params.id) ?? 0;
      const [result] = await db.execute<ResultSetHeader>(
        `UPDATE posts SET featured_at = ${req.body.featured ? 'COALESCE(featured_at, UTC_TIMESTAMP())' : 'NULL'} WHERE id = ? AND deleted_at IS NULL AND book_id IS NULL`,
        [id],
      );
      if (result.affectedRows === 0) return reply.code(404).send({ error: 'not_found' });
      const [[post]] = await db.execute<RowDataPacket[]>('SELECT title FROM posts WHERE id = ?', [id]);
      void logAdmin(db, req.user!, req.body.featured ? 'post.feature' : 'post.unfeature', { type: 'post', id, label: post!.title as string });
      return { featured: req.body.featured };
    },
  );

  // ---- Tags: every one with its posts; renaming (onto another tag's name merges them) and deleting

  app.get<{ Querystring: { q?: string } }>('/admin/tags', async (req) => {
    const q = req.query.q?.trim();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT t.id, t.name, t.slug, t.color, t.icon, COUNT(pt.post_id) AS posts FROM tags t LEFT JOIN post_tags pt ON pt.tag_id = t.id
        ${q ? 'WHERE t.name LIKE ? OR t.slug LIKE ?' : ''} GROUP BY t.id, t.name, t.slug, t.color, t.icon ORDER BY posts DESC, t.name LIMIT 500`,
      q ? [like(q), like(slugify(q))] : [],
    );
    return {
      tags: rows.map((row) => ({
        id: row.id as number,
        name: row.name as string,
        slug: row.slug as string,
        color: (row.color as string | null) ?? null,
        icon: (row.icon as string | null) ?? null,
        posts: num(row.posts),
      })),
    };
  });

  // (a name in the tags' shape, tagStyles.ts: "Full Moon" -> "full-moon"; with it, maybe its colour and sign)
  app.put<{ Params: { id: string }; Body: { name: string; color?: string | null; icon?: string | null } }>(
    '/admin/tags/:id',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 60 },
            color: { type: ['string', 'null'], maxLength: 16 },
            icon: { type: ['string', 'null'], maxLength: 16 },
          },
        },
      },
    },
    async (req, reply) => {
      const id = parseId(req.params.id) ?? 0;
      const [[tag]] = await db.execute<RowDataPacket[]>('SELECT name FROM tags WHERE id = ?', [id]);
      if (!tag) return reply.code(404).send({ error: 'not_found' });
      const name = tagName(req.body.name);
      if (!name) return reply.code(400).send({ error: 'tag_name' });
      const slug = slugify(name);
      const [other] = await db.execute<RowDataPacket[]>('SELECT id FROM tags WHERE slug = ? AND id <> ?', [slug, id]);
      if (other[0]) {
        // The same as another tag: its posts move there, and this one goes.
        await db.execute('INSERT IGNORE INTO post_tags (post_id, tag_id) SELECT post_id, ? FROM post_tags WHERE tag_id = ?', [other[0].id, id]);
        await db.execute('DELETE FROM tags WHERE id = ?', [id]);
        void logAdmin(db, req.user!, 'tag.merge', { type: 'category', id: null, label: name }, { from: tag.name });
        return { merged: other[0].id as number };
      }
      await db.execute('UPDATE tags SET name = ?, slug = ? WHERE id = ?', [name, slug, id]);
      if (req.body.color !== undefined) await db.execute('UPDATE tags SET color = ? WHERE id = ?', [tagColor(req.body.color), id]);
      if (req.body.icon !== undefined) await db.execute('UPDATE tags SET icon = ? WHERE id = ?', [tagIcon(req.body.icon), id]);
      void logAdmin(db, req.user!, 'tag.rename', { type: 'category', id: null, label: name }, { from: tag.name });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/admin/tags/:id', async (req, reply) => {
    const id = parseId(req.params.id) ?? 0;
    const [[tag]] = await db.execute<RowDataPacket[]>('SELECT name FROM tags WHERE id = ?', [id]);
    if (!tag) return reply.code(404).send({ error: 'not_found' });
    await db.execute('DELETE FROM tags WHERE id = ?', [id]);
    void logAdmin(db, req.user!, 'tag.delete', { type: 'category', id: null, label: tag.name as string });
    return { ok: true };
  });

  // ---- Comments the filters held: approving sends the notifications it would have sent; refusing deletes it

  const heldComment = async (id: number) => {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT id, post_id, user_id, parent_id, body FROM comments WHERE id = ? AND held_at IS NOT NULL AND deleted_at IS NULL', [id]);
    return rows[0] ?? null;
  };

  app.post<{ Params: { id: string } }>('/admin/comments/:id/approve', async (req, reply) => {
    const comment = await heldComment(parseId(req.params.id) ?? 0);
    if (!comment) return reply.code(404).send({ error: 'not_found' });
    await db.execute('UPDATE comments SET held_at = NULL, held_reason = NULL WHERE id = ?', [comment.id]);
    await db.execute("UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE type = 'comment_held' AND comment_id = ? AND read_at IS NULL", [comment.id]);
    void notifyComment(db, { postId: comment.post_id as number, commentId: comment.id as number, actorId: comment.user_id as number, parentId: (comment.parent_id as number | null) ?? null, body: comment.body as string });
    void logAdmin(db, req.user!, 'comment.approve', { type: 'comment', id: comment.id as number, label: commentLabel(String(comment.body)) });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/admin/comments/:id/reject', async (req, reply) => {
    const comment = await heldComment(parseId(req.params.id) ?? 0);
    if (!comment) return reply.code(404).send({ error: 'not_found' });
    await db.execute('UPDATE comments SET deleted_at = UTC_TIMESTAMP(), deleted_by = ? WHERE id = ? OR (parent_id = ? AND deleted_at IS NULL)', [req.user!.id, comment.id, comment.id]);
    await db.execute("UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE type = 'comment_held' AND comment_id = ? AND read_at IS NULL", [comment.id]);
    void logAdmin(db, req.user!, 'comment.reject', { type: 'comment', id: comment.id as number, label: commentLabel(String(comment.body)) });
    return { ok: true };
  });

  // ---- The newsletter's subscribers

  const SUBSCRIBER_STATUS = {
    active: 'confirmed_at IS NOT NULL AND unsubscribed_at IS NULL',
    pending: 'confirmed_at IS NULL AND unsubscribed_at IS NULL',
    unsubscribed: 'unsubscribed_at IS NOT NULL',
  } as const;

  app.get<{ Querystring: { q?: string; status?: keyof typeof SUBSCRIBER_STATUS; offset: number; limit: number } }>(
    '/admin/newsletter',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { q: { type: 'string', maxLength: 100 }, status: { type: 'string', enum: Object.keys(SUBSCRIBER_STATUS) }, ...paging },
        },
      },
    },
    async (req) => {
      const { q, status, offset, limit } = req.query;
      const where = [status ? SUBSCRIBER_STATUS[status] : '1 = 1', ...(q ? ['email LIKE ?'] : [])];
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT s.id, s.email, s.all_posts, s.lang, s.created_at, s.confirmed_at, s.unsubscribed_at, u.name AS user_name,
                (SELECT GROUP_CONCAT(bk.title ORDER BY nb.created_at SEPARATOR ' · ') FROM newsletter_books nb JOIN books bk ON bk.id = nb.book_id WHERE nb.subscriber_id = s.id) AS books,
                (SELECT COUNT(*) FROM newsletter_deliveries d WHERE d.subscriber_id = s.id) AS received
           FROM newsletter_subscribers s LEFT JOIN users u ON u.id = s.user_id
          WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`,
        [...(q ? [like(q)] : []), limit + 1, offset],
      );
      const [[counts]] = await db.query<RowDataPacket[]>(
        `SELECT ${Object.entries(SUBSCRIBER_STATUS)
          .map(([key, sql]) => `SUM(${sql}) AS ${key}`)
          .join(', ')}, SUM(${SUBSCRIBER_STATUS.active} AND all_posts = 0) AS books_only
           FROM newsletter_subscribers`,
      );
      return {
        subscribers: rows.slice(0, limit).map((row) => ({
          id: row.id as number,
          email: row.email as string,
          allPosts: Boolean(row.all_posts),
          books: (row.books as string | null) ?? null,
          lang: row.lang as string,
          createdAt: row.created_at as Date,
          confirmedAt: row.confirmed_at as Date | null,
          unsubscribedAt: row.unsubscribed_at as Date | null,
          account: (row.user_name as string | null) ?? null,
          received: num(row.received),
        })),
        hasMore: rows.length > limit,
        counts: {
          active: num(counts!.active),
          pending: num(counts!.pending),
          unsubscribed: num(counts!.unsubscribed),
          booksOnly: num(counts!.books_only),
        },
        enabled: siteSettings().newsletterEnabled,
        mail: mailConfigured(),
      };
    },
  );

  app.delete<{ Params: { id: string } }>('/admin/newsletter/:id', async (req, reply) => {
    const id = parseId(req.params.id) ?? 0;
    const [[row]] = await db.execute<RowDataPacket[]>('SELECT email FROM newsletter_subscribers WHERE id = ?', [id]);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    await db.execute('DELETE FROM newsletter_subscribers WHERE id = ?', [id]);
    void logAdmin(db, req.user!, 'newsletter.delete', { type: 'user', id: null, label: row.email as string });
    return { ok: true };
  });


  // ---- Books: every one (hidden and deleted ones too), with its chapters, its numbers and who waits for its next
  // chapter; an administrator hides or shows one, deletes an empty one, restores a deleted one.

  const BOOK_STATUS = {
    all: 'bk.deleted_at IS NULL',
    public: publicBook(),
    hidden: `bk.deleted_at IS NULL AND NOT (${publicBook()})`,
    ongoing: 'bk.deleted_at IS NULL AND bk.completed_at IS NULL',
    complete: 'bk.deleted_at IS NULL AND bk.completed_at IS NOT NULL',
    deleted: 'bk.deleted_at IS NOT NULL',
  } as const;
  type BookStatus = keyof typeof BOOK_STATUS;
  const BOOK_SORT = {
    updated: 'bk.updated_at DESC, bk.id DESC',
    new: 'bk.created_at DESC, bk.id DESC',
    title: 'bk.title, bk.id',
    views: 'views DESC, bk.id DESC',
    followers: 'email_followers + device_followers DESC, bk.id DESC',
  } as const;
  const BOOK_NUMBERS = `,
    bk.deleted_at,
    (SELECT COUNT(*) FROM posts p WHERE p.book_id = bk.id AND p.deleted_at IS NULL AND p.status = 'draft') AS drafts,
    (SELECT COUNT(*) FROM posts p WHERE p.book_id = bk.id AND p.deleted_at IS NULL AND p.status = 'published' AND p.published_at > UTC_TIMESTAMP()) AS scheduled,
    (SELECT COALESCE(SUM(p.view_count), 0) FROM posts p WHERE p.book_id = bk.id AND p.deleted_at IS NULL) AS views,
    (SELECT COUNT(*) FROM post_likes l JOIN posts p ON p.id = l.post_id WHERE p.book_id = bk.id AND p.deleted_at IS NULL AND l.removed_at IS NULL) AS likes,
    (SELECT COUNT(*) FROM comments m JOIN posts p ON p.id = m.post_id WHERE p.book_id = bk.id AND p.deleted_at IS NULL AND m.deleted_at IS NULL) AS comments,
    (SELECT COUNT(DISTINCT r.user_id) FROM reading_progress r JOIN posts p ON p.id = r.post_id WHERE p.book_id = bk.id) AS readers,
    (SELECT COUNT(*) FROM newsletter_books nb JOIN newsletter_subscribers s ON s.id = nb.subscriber_id
      WHERE nb.book_id = bk.id AND s.confirmed_at IS NOT NULL AND s.unsubscribed_at IS NULL) AS email_followers,
    (SELECT COUNT(*) FROM push_books pb WHERE pb.book_id = bk.id) AS device_followers`;

  const adminBook = (row: RowDataPacket) => ({
    ...toBook(row),
    deletedAt: (row.deleted_at as Date | null) ?? null,
    drafts: num(row.drafts),
    scheduled: num(row.scheduled),
    views: num(row.views),
    likes: num(row.likes),
    comments: num(row.comments),
    /** Signed-in readers who started it. */
    readers: num(row.readers),
    /** Waiting for its next chapter ("Notify me"): by email, on a device. */
    followers: { email: num(row.email_followers), devices: num(row.device_followers) },
  });

  app.get<{ Querystring: { q?: string; author?: number; status: BookStatus; sort: keyof typeof BOOK_SORT; offset: number; limit: number } }>(
    '/admin/books',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 100 },
            author: { type: 'integer', minimum: 1 },
            status: { type: 'string', enum: Object.keys(BOOK_STATUS), default: 'all' },
            sort: { type: 'string', enum: Object.keys(BOOK_SORT), default: 'updated' },
            ...paging,
          },
        },
      },
    },
    async (req) => {
      const { q, author, status, sort, offset, limit } = req.query;
      const base: string[] = [];
      const params: unknown[] = [];
      for (const word of searchWords(q)) {
        base.push('(bk.title LIKE ? OR u.name LIKE ?)');
        params.push(word, word);
      }
      if (author) {
        base.push('bk.author_id = ?');
        params.push(author);
      }
      const where = [...base, BOOK_STATUS[status]].join(' AND ');
      const [rows] = await db.query<RowDataPacket[]>(`${bookSelect(BOOK_NUMBERS)} WHERE ${where} ORDER BY ${BOOK_SORT[sort]} LIMIT ? OFFSET ?`, [
        ...params,
        limit + 1,
        offset,
      ]);
      const [[counts]] = await db.query<RowDataPacket[]>(
        `SELECT ${Object.entries(BOOK_STATUS)
          .map(([key, sql]) => `SUM(${sql}) AS \`${key}\``)
          .join(', ')}
           FROM books bk JOIN users u ON u.id = bk.author_id ${base.length ? `WHERE ${base.join(' AND ')}` : ''}`,
        params,
      );
      return {
        books: rows.slice(0, limit).map(adminBook),
        hasMore: rows.length > limit,
        counts: Object.fromEntries(Object.keys(BOOK_STATUS).map((key) => [key, num(counts![key])])),
      };
    },
  );

  const bookRow = async (id: number) => {
    const [rows] = await db.query<RowDataPacket[]>(`${bookSelect(BOOK_NUMBERS)} WHERE bk.id = ?`, [id]);
    return rows[0] ? adminBook(rows[0]) : null;
  };

  // Shown or hidden on the site (what its author does from the book's page): a book that shouldn't be there yet.
  app.post<{ Params: { id: string }; Body: { published: boolean } }>(
    '/admin/books/:id/published',
    { schema: { body: { type: 'object', required: ['published'], additionalProperties: false, properties: { published: { type: 'boolean' } } } } },
    async (req, reply) => {
      const id = parseId(req.params.id) ?? 0;
      const [result] = await db.execute<ResultSetHeader>(
        `UPDATE books SET published_at = ${req.body.published ? 'COALESCE(published_at, UTC_TIMESTAMP())' : 'NULL'} WHERE id = ? AND deleted_at IS NULL`,
        [id],
      );
      if (result.affectedRows === 0) return reply.code(404).send({ error: 'not_found' });
      forgetThought();
      const book = await bookRow(id);
      void logAdmin(db, req.user!, req.body.published ? 'book.publish' : 'book.unpublish', { type: 'book', id, label: book!.title }, { author: book!.author.name });
      return { book };
    },
  );

  // A book goes once it has no chapters (as its author deletes it); a deleted one comes back.
  app.delete<{ Params: { id: string } }>('/admin/books/:id', async (req, reply) => {
    const book = await bookRow(parseId(req.params.id) ?? 0);
    if (!book || book.deletedAt) return reply.code(404).send({ error: 'not_found' });
    if (book.allChapters > 0) return reply.code(409).send({ error: 'book_not_empty' });
    await db.execute('UPDATE books SET deleted_at = UTC_TIMESTAMP() WHERE id = ?', [book.id]);
    forgetThought();
    void logAdmin(db, req.user!, 'book.delete', { type: 'book', id: book.id, label: book.title }, { author: book.author.name });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/admin/books/:id/restore', async (req, reply) => {
    const id = parseId(req.params.id) ?? 0;
    const [result] = await db.execute<ResultSetHeader>('UPDATE books SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL', [id]);
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'not_found' });
    forgetThought();
    const book = await bookRow(id);
    void logAdmin(db, req.user!, 'book.restore', { type: 'book', id, label: book!.title }, { author: book!.author.name });
    return { book };
  });

  // ---- Invitations to write

  app.get('/admin/invites', async () => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT i.id, i.email, i.message, i.created_at, i.expires_at, i.accepted_at, i.revoked_at, b.name AS invited_by, a.name AS accepted_name, a.id AS accepted_id
         FROM invites i LEFT JOIN users b ON b.id = i.invited_by LEFT JOIN users a ON a.id = i.accepted_user_id
        ORDER BY i.created_at DESC LIMIT 200`,
    );
    const now = Date.now();
    return {
      invites: rows.map((row) => ({
        id: row.id as number,
        email: row.email as string,
        message: row.message as string | null,
        createdAt: row.created_at as Date,
        expiresAt: row.expires_at as Date,
        invitedBy: (row.invited_by as string | null) ?? null,
        status: row.accepted_at ? 'accepted' : row.revoked_at ? 'revoked' : (row.expires_at as Date).getTime() < now ? 'expired' : 'pending',
        accepted: row.accepted_id ? { id: row.accepted_id as number, name: row.accepted_name as string } : null,
      })),
      mail: mailConfigured(),
    };
  });

  app.post<{ Body: { email: string; message?: string; lang?: string } }>(
    '/admin/invites',
    {
      config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: { email: { type: 'string', format: 'email', maxLength: 255 }, message: { type: 'string', maxLength: 500 }, lang: { type: 'string', enum: ['ro', 'en'] } },
        },
      },
    },
    async (req, reply) => {
      if (!mailConfigured()) return reply.code(503).send({ error: 'email_unavailable' });
      const email = req.body.email.trim().toLowerCase();
      const [users] = await db.execute<RowDataPacket[]>('SELECT role FROM users WHERE email = ? AND purged_at IS NULL', [email]);
      if (users[0] && users[0].role !== 'member') return reply.code(409).send({ error: 'already_author' });
      // One pending invitation per address: sending again replaces its link.
      await db.execute('UPDATE invites SET revoked_at = UTC_TIMESTAMP() WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL', [email]);
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO invites (token_hash, email, message, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [`pending-${Date.now()}-${Math.random()}`.slice(0, 64), email, req.body.message?.trim() || null, req.user!.id],
      );
      const sent = await sendInvite(db, { id: result.insertId, email, message: req.body.message?.trim() || null }, req.user!.name, langOf(req.body.lang));
      void logAdmin(db, req.user!, 'invite.create', { type: 'user', id: null, label: email });
      return { id: result.insertId, sent };
    },
  );

  app.post<{ Params: { id: string } }>('/admin/invites/:id/resend', async (req, reply) => {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT id, email, message FROM invites WHERE id = ? AND accepted_at IS NULL', [parseId(req.params.id) ?? 0]);
    const invite = rows[0];
    if (!invite) return reply.code(404).send({ error: 'not_found' });
    const sent = await sendInvite(db, { id: invite.id as number, email: invite.email as string, message: invite.message as string | null }, req.user!.name, site.defaultLanguage);
    void logAdmin(db, req.user!, 'invite.resend', { type: 'user', id: null, label: invite.email as string });
    return { sent };
  });

  app.delete<{ Params: { id: string } }>('/admin/invites/:id', async (req, reply) => {
    const id = parseId(req.params.id) ?? 0;
    const [result] = await db.execute<ResultSetHeader>('UPDATE invites SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL', [id]);
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'not_found' });
    const [[row]] = await db.execute<RowDataPacket[]>('SELECT email FROM invites WHERE id = ?', [id]);
    void logAdmin(db, req.user!, 'invite.revoke', { type: 'user', id: null, label: row!.email as string });
    return { ok: true };
  });

  // ---- The media library: posts' images, where each is used, and those nothing uses

  async function mediaUsage() {
    const files = (await fs.promises.readdir(config.uploadsDir, { withFileTypes: true })).filter((f) => f.isFile() && POST_IMAGE.test(f.name));
    const [posts] = await db.query<RowDataPacket[]>('SELECT id, title, slug, banner_url, social_image_url, content_html, deleted_at FROM posts');
    const [revisions] = await db.query<RowDataPacket[]>('SELECT content_html, banner_url FROM post_revisions');
    const uses = new Map<string, { id: number; title: string; slug: string; deleted: boolean }[]>();
    for (const post of posts) {
      const found = new Set<string>();
      for (const value of [post.banner_url, post.social_image_url]) if (typeof value === 'string') found.add(value);
      for (const match of String(post.content_html).matchAll(/\/uploads\/[\w.-]+/g)) found.add(match[0]);
      for (const url of found) {
        const list = uses.get(url) ?? [];
        list.push({ id: post.id as number, title: post.title as string, slug: post.slug as string, deleted: post.deleted_at !== null });
        uses.set(url, list);
      }
    }
    const inRevisions = new Set<string>();
    for (const r of revisions) {
      if (typeof r.banner_url === 'string') inRevisions.add(r.banner_url);
      for (const match of String(r.content_html).matchAll(/\/uploads\/[\w.-]+/g)) inRevisions.add(match[0]);
    }
    const now = Date.now();
    return Promise.all(
      files.map(async (file) => {
        const stat = await fs.promises.stat(path.join(config.uploadsDir, file.name));
        const url = `/uploads/${file.name}`;
        const used = uses.get(url) ?? [];
        return {
          name: file.name,
          url,
          size: stat.size,
          modifiedAt: stat.mtime,
          posts: used,
          /** Only an earlier version of a post has it (restoring that version would need it). */
          inVersions: used.length === 0 && inRevisions.has(url),
          recent: now - stat.mtimeMs < RECENT_MS,
        };
      }),
    );
  }

  const unused = (m: Awaited<ReturnType<typeof mediaUsage>>[number]) => m.posts.length === 0 && !m.inVersions && !m.recent;

  app.get<{ Querystring: { filter?: 'all' | 'used' | 'unused' } }>(
    '/admin/media',
    { schema: { querystring: { type: 'object', properties: { filter: { type: 'string', enum: ['all', 'used', 'unused'] } } } } },
    async (req) => {
      const all = (await mediaUsage()).sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
      const filter = req.query.filter ?? 'all';
      const shown = filter === 'used' ? all.filter((m) => m.posts.length > 0) : filter === 'unused' ? all.filter(unused) : all;
      const unusedAll = all.filter(unused);
      return {
        media: shown,
        counts: { all: all.length, used: all.filter((m) => m.posts.length > 0).length, unused: unusedAll.length },
        totalSize: all.reduce((sum, m) => sum + m.size, 0),
        unusedSize: unusedAll.reduce((sum, m) => sum + m.size, 0),
      };
    },
  );

  app.delete<{ Params: { name: string } }>('/admin/media/:name', async (req, reply) => {
    const item = (await mediaUsage()).find((m) => m.name === req.params.name);
    if (!item) return reply.code(404).send({ error: 'not_found' });
    if (!unused(item)) return reply.code(409).send({ error: 'media_in_use' });
    await fs.promises.rm(path.join(config.uploadsDir, item.name), { force: true });
    void logAdmin(db, req.user!, 'media.delete', { type: 'settings', id: null, label: item.name });
    return { ok: true };
  });

  // Every image nothing uses (older than a day).
  app.post('/admin/media/cleanup', async (req) => {
    const gone = (await mediaUsage()).filter(unused);
    for (const item of gone) await fs.promises.rm(path.join(config.uploadsDir, item.name), { force: true });
    if (gone.length) void logAdmin(db, req.user!, 'media.cleanup', { type: 'settings', id: null, label: `${gone.length}` }, { files: gone.length, bytes: gone.reduce((s, m) => s + m.size, 0) });
    return { deleted: gone.length };
  });

  // ---- What readers search for (counted per day; nothing about who)

  app.get<{ Querystring: { days: 7 | 30 | 90 } }>(
    '/admin/search-insights',
    { schema: { querystring: { type: 'object', properties: { days: { type: 'integer', enum: [7, 30, 90], default: 30 } } } } },
    async (req) => {
      const from = siteDay(new Date(Date.now() - (req.query.days - 1) * 86_400_000));
      const [top] = await db.query<RowDataPacket[]>(
        'SELECT query, SUM(searches) AS searches, SUM(no_results) AS no_results FROM search_log WHERE day >= ? GROUP BY query ORDER BY searches DESC, query LIMIT 20',
        [from],
      );
      const [empty] = await db.query<RowDataPacket[]>(
        'SELECT query, SUM(no_results) AS no_results FROM search_log WHERE day >= ? GROUP BY query HAVING no_results > 0 ORDER BY no_results DESC, query LIMIT 20',
        [from],
      );
      const [[totals]] = await db.query<RowDataPacket[]>('SELECT SUM(searches) AS searches, SUM(no_results) AS no_results FROM search_log WHERE day >= ?', [from]);
      return {
        top: top.map((row) => ({ query: row.query as string, searches: num(row.searches), noResults: num(row.no_results) })),
        empty: empty.map((row) => ({ query: row.query as string, noResults: num(row.no_results) })),
        totals: { searches: num(totals!.searches), noResults: num(totals!.no_results) },
      };
    },
  );

  // ---- The site's identity: name, description, languages, contact, social links, logo

  app.get('/admin/settings/identity', async () => ({ identity: site, customLogo: customLogo() }));

  const text = (max: number) => ({ type: 'string', maxLength: max }) as const;
  app.put<{ Body: SiteIdentity }>(
    '/admin/settings/identity',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'company', 'description', 'language', 'locale', 'timeZone', 'defaultLanguage', 'contactEmail', 'social'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 60 },
            company: text(80),
            description: text(300),
            language: { type: 'string', pattern: '^[a-z]{2}$' },
            locale: { type: 'string', pattern: '^[a-z]{2}_[A-Z]{2}$' },
            timeZone: { type: 'string', maxLength: 60 },
            defaultLanguage: { type: 'string', enum: ['ro', 'en'] },
            contactEmail: { anyOf: [{ type: 'string', format: 'email', maxLength: 255 }, { type: 'string', maxLength: 0 }] },
            social: {
              type: 'object',
              additionalProperties: false,
              properties: Object.fromEntries(SOCIAL.map((key) => [key, { anyOf: [{ type: 'string', pattern: '^https://\\S+$', maxLength: 300 }, { type: 'string', maxLength: 0 }] }])),
            },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: req.body.timeZone });
      } catch {
        return reply.code(400).send({ error: 'invalid_input', message: 'timeZone' });
      }
      const before = { ...site, social: { ...site.social } };
      const next = { ...req.body, name: req.body.name.trim(), company: req.body.company.trim() || req.body.name.trim() };
      await saveSiteIdentity(db, next);
      const changed = (Object.keys(next) as (keyof SiteIdentity)[]).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(before[key]));
      if (changed.length) void logAdmin(db, req.user!, 'settings.identity', { type: 'settings', id: null, label: 'Identitate' }, { changed });
      return { identity: site };
    },
  );

  // A new logo: a square-ish image, at least 256px, kept as a PNG of at most 1024px.
  app.post('/admin/settings/logo', async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 8 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: 'file_missing' });
    let png: Buffer;
    try {
      const image = sharp(await file.toBuffer());
      const meta = await image.metadata();
      if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 256) return reply.code(400).send({ error: 'logo_too_small' });
      png = await image.resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    } catch {
      return reply.code(400).send({ error: 'image_unreadable' });
    }
    await setLogo(png);
    void logAdmin(db, req.user!, 'settings.logo', { type: 'settings', id: null, label: 'Logo' });
    return { customLogo: true };
  });

  app.delete('/admin/settings/logo', async (req) => {
    await setLogo(null);
    void logAdmin(db, req.user!, 'settings.logo_reset', { type: 'settings', id: null, label: 'Logo' });
    return { customLogo: false };
  });

  // ---- The site's settings (Settings → General): every rule at once

  app.get('/admin/settings/site', async () => ({ settings: siteSettings(), mailConfigured: mailConfigured() }));

  app.put<{ Body: SiteSettings }>(
    '/admin/settings/site',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            commentsRequireVerifiedEmail: { type: 'boolean' },
            firstCommentApproval: { type: 'boolean' },
            blockedWords: { type: 'array', maxItems: 500, items: { type: 'string', maxLength: 60 } },
            blockedWordsAction: { type: 'string', enum: ['hold', 'block'] },
            links: { type: 'string', enum: ['allow', 'hold', 'block'] },
            announcement: {
              type: 'object',
              additionalProperties: false,
              properties: {
                enabled: { type: 'boolean' },
                text: text(300),
                linkUrl: { anyOf: [{ type: 'string', pattern: '^(https://\\S+|/\\S*)$', maxLength: 300 }, { type: 'string', maxLength: 0 }] },
                linkLabel: text(60),
                tone: { type: 'string', enum: ['info', 'success', 'warning'] },
              },
            },
            newsletterEnabled: { type: 'boolean' },
            maintenance: { type: 'boolean' },
            maintenanceMessage: text(500),
          },
        },
      },
    },
    async (req) => {
      const before = siteSettings();
      const blockedWords = req.body.blockedWords ? [...new Set(req.body.blockedWords.map((w) => w.trim()).filter(Boolean))] : before.blockedWords;
      const next = await saveSiteSettings(db, { ...before, ...req.body, blockedWords, announcement: { ...before.announcement, ...(req.body.announcement ?? {}) } });
      const changed = (Object.keys(next) as (keyof SiteSettings)[]).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(before[key]));
      if (changed.length) {
        void logAdmin(db, req.user!, 'settings.site', { type: 'settings', id: null, label: 'General' }, Object.fromEntries(changed.map((key) => [key, key === 'blockedWords' ? `${next.blockedWords.length}` : next[key]])));
      }
      return { settings: next };
    },
  );
};

export default adminContentRoutes;
