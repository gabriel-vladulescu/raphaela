import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { requireWriter } from '@/lib/guards';
import { uniqueSlug } from '@/lib/slug';

/** Series of posts ("Part 2 of 4"): the editor lists them and creates new ones; a post picks one (routes/posts.ts). */
const seriesRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get('/series', { preHandler: requireWriter }, async () => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT s.id, s.title, s.slug, COUNT(p.id) AS posts
         FROM series s LEFT JOIN posts p ON p.series_id = s.id AND p.deleted_at IS NULL
        GROUP BY s.id, s.title, s.slug
        ORDER BY s.title`,
    );
    return { series: rows.map((row) => ({ id: row.id as number, title: row.title as string, slug: row.slug as string, posts: Number(row.posts) })) };
  });

  app.post<{ Body: { title: string } }>(
    '/series',
    {
      preHandler: requireWriter,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { body: { type: 'object', required: ['title'], additionalProperties: false, properties: { title: { type: 'string', maxLength: 160 } } } },
    },
    async (req, reply) => {
      const title = req.body.title.trim();
      if (title.length < 2) return reply.code(400).send({ error: 'series_title_invalid' });
      const slug = await uniqueSlug(db, 'series', title);
      const [result] = await db.execute<ResultSetHeader>('INSERT INTO series (title, slug, author_id) VALUES (?, ?, ?)', [title, slug, req.user!.id]);
      return { series: { id: result.insertId, title, slug, posts: 0 } };
    },
  );
};

export default seriesRoutes;
