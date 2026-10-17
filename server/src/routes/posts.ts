import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { loadCategoryIndex } from '@/lib/categories';
import { parseId, requireUser } from '@/lib/guards';
import { likeCount, setLike } from '@/lib/likes';
import { escapeLike, loadPostPage, postSelect, toPostSummary, VISIBLE_POST } from '@/lib/posts';

interface ListQuery {
  q?: string;
  category?: string;
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
            ids: { type: 'string', maxLength: 2000 },
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 },
          },
        },
      },
    },
    async (req) => {
      const { q, category, ids, page, limit } = req.query;
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
      if (ids !== undefined) {
        const idList = ids.split(',').map(Number).filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 200);
        if (idList.length === 0) return empty;
        where.push('p.id IN (?)');
        params.push(idList);
      }

      const [rows] = await db.query<RowDataPacket[]>(
        `${postSelect()} WHERE ${where.join(' AND ')}
         ORDER BY p.published_at DESC, p.id DESC LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}`,
        params,
      );
      return { posts: rows.slice(0, limit).map(toPostSummary), hasMore: rows.length > limit };
    },
  );

  // Authors can also open their own drafts and scheduled posts (preview); owners anything, deleted posts too.
  app.get<{ Params: { slug: string } }>('/posts/:slug', async (req, reply) => {
    const page = await loadPostPage(db, req.params.slug, req.user);
    if (!page) return reply.code(404).send({ error: 'not_found' });
    return { post: page.post };
  });

  // Likes are public: an account's, or a guest's browser's (lib/likes.ts). Crawlers and scripts can't like.
  const likeLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };
  app.put<{ Params: { id: string } }>('/posts/:id/like', { config: likeLimit }, async (req, reply) => {
    const id = parseId(req.params.id) ?? 0;
    const [visible] = await db.query<RowDataPacket[]>(`SELECT p.id FROM posts p WHERE p.id = ? AND ${VISIBLE_POST}`, [id]);
    if (!visible[0]) return reply.code(404).send({ error: 'not_found' });
    if (req.visitor.bot) return reply.code(403).send({ error: 'forbidden' });
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
