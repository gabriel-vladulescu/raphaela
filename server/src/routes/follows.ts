import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { parseId, requireUser } from '@/lib/guards';

/**
 * Following authors: their new posts reach their followers as such (lib/notifications.ts, followed_post). An author
 * sees how many follow them; nobody sees who.
 */
const followRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  /** An author (anyone with posts, not deleted) and their followers. */
  const author = async (id: number | null) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT u.id, (SELECT COUNT(*) FROM author_follows f WHERE f.author_id = u.id) AS followers
         FROM users u WHERE u.id = ? AND u.deleted_at IS NULL AND (u.role = 'author' OR EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.id))`,
      [id ?? 0],
    );
    return rows[0] ? { id: rows[0].id as number, followers: Number(rows[0].followers) } : null;
  };

  app.get<{ Params: { id: string } }>('/authors/:id/follow', async (req, reply) => {
    const found = await author(parseId(req.params.id));
    if (!found) return reply.code(404).send({ error: 'not_found' });
    const [mine] = req.user
      ? await db.execute<RowDataPacket[]>('SELECT 1 FROM author_follows WHERE user_id = ? AND author_id = ?', [req.user.id, found.id])
      : [[]];
    return { following: mine.length > 0, followers: found.followers };
  });

  app.put<{ Params: { id: string } }>('/authors/:id/follow', { preHandler: requireUser, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const found = await author(parseId(req.params.id));
    if (!found) return reply.code(404).send({ error: 'not_found' });
    if (found.id === req.user!.id) return reply.code(400).send({ error: 'follow_self' });
    await db.execute('INSERT IGNORE INTO author_follows (user_id, author_id, created_at) VALUES (?, ?, UTC_TIMESTAMP())', [req.user!.id, found.id]);
    return { following: true, followers: (await author(found.id))!.followers };
  });

  app.delete<{ Params: { id: string } }>('/authors/:id/follow', { preHandler: requireUser }, async (req, reply) => {
    const found = await author(parseId(req.params.id));
    if (!found) return reply.code(404).send({ error: 'not_found' });
    await db.execute('DELETE FROM author_follows WHERE user_id = ? AND author_id = ?', [req.user!.id, found.id]);
    return { following: false, followers: (await author(found.id))!.followers };
  });

  // The authors the signed-in person follows (the Settings page lists them, to unfollow).
  app.get('/me/following', { preHandler: requireUser }, async (req) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT u.id, u.name, u.username, COALESCE(u.avatar_url, u.picture) AS picture FROM author_follows f JOIN users u ON u.id = f.author_id
        WHERE f.user_id = ? AND u.deleted_at IS NULL ORDER BY u.name`,
      [req.user!.id],
    );
    return { authors: rows.map((row) => ({ id: row.id as number, name: row.name as string, username: row.username as string, picture: row.picture as string | null })) };
  });
};

export default followRoutes;
