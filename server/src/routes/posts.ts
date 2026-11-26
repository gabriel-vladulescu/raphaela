import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { loadCategoryIndex } from '@/lib/categories';
import { canWrite, parseId, requireUser, requireWriter } from '@/lib/guards';
import { likeCount, setLike } from '@/lib/likes';
import { escapeLike, IS_POST, loadPostPage, loadPreviewPage, postPath, postSelect, toPostSummary, VISIBLE_POST, visibleTo } from '@/lib/posts';
import type { SessionUser } from '@/lib/session';
import { createTag, findTag, popularTags } from '@/lib/tags';
import { keepVisitor } from '@/lib/visitor';

interface ListQuery {
  q?: string;
  category?: string;
  tag?: string;
  ids?: string;
  page: number;
  limit: number;
}

const postRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  // Public feed: search, category (including sub-categories) and explicit ids (guest bookmarks).
  app.get<{ Querystring: ListQuery }>(
    '/posts',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 100 },
            category: { type: 'string', maxLength: 100 },
            tag: { type: 'string', maxLength: 100 },
            ids: { type: 'string', maxLength: 2000 },
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 },
          },
        },
      },
    },
    async (req) => {
      const { q, category, tag, ids, page, limit } = req.query;
      const where = [VISIBLE_POST];
      const params: unknown[] = [];
      const empty = { posts: [], hasMore: false };

      for (const word of (q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8)) {
        const like = `%${escapeLike(word)}%`;
        where.push('(p.title LIKE ? OR p.excerpt LIKE ? OR p.content_text LIKE ?)');
        params.push(like, like, like);
      }
      if (category) {
        const [rows] = await db.execute<RowDataPacket[]>('SELECT id FROM categories WHERE slug = ?', [category]);
        if (!rows[0]) return empty;
        where.push('p.category_id IN (?)');
        params.push((await loadCategoryIndex(db)).descendants(rows[0].id));
      }
      if (tag) {
        where.push('p.id IN (SELECT pt.post_id FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE t.slug = ?)');
        params.push(tag);
      }
      if (ids !== undefined) {
        const idList = ids.split(',').map(Number).filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 200);
        if (idList.length === 0) return empty;
        where.push('p.id IN (?)');
        params.push(idList);
      }

      // The journal is the articles: the books' chapters are in the books. A search finds both, and so do a tag
      // (both have tags) and saved ones (ids).
      if (!q?.trim() && ids === undefined && !tag) where.push(IS_POST);

      // The journal (nothing narrowed): the posts an administrator featured come first, the latest featured on top.
      const home = !q && !category && !tag && ids === undefined;
      const [rows] = await db.query<RowDataPacket[]>(
        `${postSelect()} WHERE ${where.join(' AND ')}
         ORDER BY ${home ? 'p.featured_at IS NULL, p.featured_at DESC, ' : ''}p.published_at DESC, p.id DESC LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}`,
        params,
      );
      return { posts: rows.slice(0, limit).map(toPostSummary), hasMore: rows.length > limit };
    },
  );

  /**
   * Where a slug leads now, when it isn't a post's (or chapter's) own any more: a chapter under its book, or the new
   * address of a renamed one (an old one: shared links, search engines). Null: nowhere.
   */
  async function movedTo(slug: string, user: SessionUser | null) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT p.slug, bk.slug AS book_slug FROM posts p LEFT JOIN books bk ON bk.id = p.book_id
        WHERE (p.slug = ? OR p.id = (SELECT r.post_id FROM post_redirects r WHERE r.old_slug = ?)) AND ${visibleTo(user)}
        ORDER BY p.slug = ? DESC LIMIT 1`,
      [slug, slug, slug],
    );
    return rows[0] ? postPath(rows[0].slug as string, (rows[0].book_slug as string | null) ?? null) : null;
  }

  // A post. Authors can also open their own drafts and scheduled posts (preview); owners anything, deleted posts
  // too. A chapter's slug, or an old address: `moved`, with where to go.
  app.get<{ Params: { slug: string } }>('/posts/:slug', async (req, reply) => {
    const page = await loadPostPage(db, req.params.slug, req.user);
    if (page) return { post: page.post };
    const path = await movedTo(req.params.slug, req.user);
    if (path) return reply.code(404).send({ error: 'moved', path });
    return reply.code(404).send({ error: 'not_found' });
  });

  // A chapter, under its book (the same page as a post's, with the book's contents). Moved (a renamed chapter,
  // or one moved to another book): `moved`, with where to go.
  app.get<{ Params: { book: string; slug: string } }>('/books/:book/chapters/:slug', async (req, reply) => {
    const page = await loadPostPage(db, req.params.slug, req.user, req.params.book);
    if (page) return { post: page.post };
    const path = await movedTo(req.params.slug, req.user);
    if (path) return reply.code(404).send({ error: 'moved', path });
    return reply.code(404).send({ error: 'not_found' });
  });

  // A post by its secret preview link, whatever its state (not for search engines: the page says noindex).
  app.get<{ Params: { token: string } }>('/preview/:token', async (req, reply) => {
    if (!/^[0-9a-f]{32}$/.test(req.params.token)) return reply.code(404).send({ error: 'not_found' });
    const page = await loadPreviewPage(db, req.params.token);
    if (!page) return reply.code(404).send({ error: 'not_found' });
    return { post: page.post };
  });

  // Tags: the most used (with their public posts), or those matching `q`. `all`, for writers (the editor's picker):
  // those without public posts too.
  app.get<{ Querystring: { q?: string; limit: number; all?: boolean } }>(
    '/tags',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 60 },
            limit: { type: 'integer', minimum: 1, maximum: 300, default: 30 },
            all: { type: 'boolean' },
          },
        },
      },
    },
    async (req) => {
      const all = Boolean(req.query.all && req.user && canWrite(req.user));
      return { tags: await popularTags(db, req.query.q?.trim() || undefined, all ? req.query.limit : Math.min(req.query.limit, 100), all) };
    },
  );

  // A new tag (the editor's picker): its name in shape ("full-moon"), a colour and a sign. One with the same words
  // is there already: that one comes back (200), as it is.
  app.post<{ Body: { name: string; color?: string | null; icon?: string | null } }>(
    '/tags',
    {
      preHandler: requireWriter,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80 },
            color: { type: ['string', 'null'], maxLength: 16 },
            icon: { type: ['string', 'null'], maxLength: 16 },
          },
        },
      },
    },
    async (req, reply) => {
      const made = await createTag(db, req.body);
      if (!made) return reply.code(400).send({ error: 'tag_name' });
      return reply.code(made.created ? 201 : 200).send(made);
    },
  );

  app.get<{ Params: { slug: string } }>('/tags/:slug', async (req, reply) => {
    const tag = await findTag(db, req.params.slug);
    if (!tag) return reply.code(404).send({ error: 'not_found' });
    return { tag };
  });

  // Likes are public: an account's, or a guest's browser's (lib/likes.ts). Crawlers and scripts can't like.
  const likeLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };
  app.put<{ Params: { id: string } }>('/posts/:id/like', { config: likeLimit }, async (req, reply) => {
    const id = parseId(req.params.id) ?? 0;
    const [visible] = await db.query<RowDataPacket[]>(`SELECT p.id FROM posts p WHERE p.id = ? AND ${VISIBLE_POST}`, [id]);
    if (!visible[0]) return reply.code(404).send({ error: 'not_found' });
    if (req.visitor.bot) return reply.code(403).send({ error: 'forbidden' });
    if (!req.user) keepVisitor(req, reply); // a guest's like is remembered by their visitor cookie
    await setLike(db, req, id, true);
    return { liked: true, likeCount: await likeCount(db, id) };
  });

  app.delete<{ Params: { id: string } }>('/posts/:id/like', { config: likeLimit }, async (req, reply) => {
    const id = parseId(req.params.id);
    if (!id) return reply.code(404).send({ error: 'not_found' });
    await setLike(db, req, id, false);
    return { liked: false, likeCount: await likeCount(db, id) };
  });

  // Bookmarks need an account (guests keep theirs in the browser); administrators don't save posts.
  app.put<{ Params: { id: string } }>('/posts/:id/bookmark', { preHandler: requireUser }, async (req, reply) => {
    if (req.user!.role === 'owner') return reply.code(403).send({ error: 'forbidden' });
    const id = parseId(req.params.id) ?? 0;
    const [visible] = await db.query<RowDataPacket[]>(`SELECT p.id FROM posts p WHERE p.id = ? AND ${VISIBLE_POST}`, [id]);
    if (!visible[0]) return reply.code(404).send({ error: 'not_found' });
    await db.execute('INSERT IGNORE INTO post_bookmarks (user_id, post_id) VALUES (?, ?)', [req.user!.id, id]);
    return { bookmarked: true };
  });

  app.delete<{ Params: { id: string } }>('/posts/:id/bookmark', { preHandler: requireUser }, async (req, reply) => {
    const id = parseId(req.params.id);
    if (!id) return reply.code(404).send({ error: 'not_found' });
    await db.execute('DELETE FROM post_bookmarks WHERE user_id = ? AND post_id = ?', [req.user!.id, id]);
    return { bookmarked: false };
  });
};

export default postRoutes;
