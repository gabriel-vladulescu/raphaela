import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { parseId, requireOwner } from '@/lib/guards';

// Owners give or take the author role. The owner role itself comes from OWNER_EMAILS, so it isn't changed here.
const userRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get('/users', { preHandler: requireOwner }, async () => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT u.id, u.name, u.email, COALESCE(u.avatar_url, u.picture) AS picture, u.role, u.created_at,
              (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS post_count
         FROM users u
        ORDER BY FIELD(u.role, 'owner', 'author', 'member'), u.name`,
    );
    return {
      users: rows.map((row) => ({
        id: row.id as number,
        name: row.name as string,
        email: row.email as string,
        picture: row.picture as string | null,
        role: row.role as string,
        createdAt: row.created_at as Date,
        postCount: Number(row.post_count),
      })),
    };
  });

  app.patch<{ Params: { id: string }; Body: { role: 'member' | 'author' } }>(
    '/users/:id',
    {
      preHandler: requireOwner,
      schema: {
        body: {
          type: 'object',
          required: ['role'],
          additionalProperties: false,
          properties: { role: { type: 'string', enum: ['member', 'author'] } },
        },
      },
    },
    async (req, reply) => {
      const id = parseId(req.params.id);
      const [rows] = await db.execute<RowDataPacket[]>('SELECT role FROM users WHERE id = ?', [id ?? 0]);
      if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
      if (rows[0].role === 'owner') return reply.code(403).send({ error: 'role_locked' });
      await db.execute('UPDATE users SET role = ? WHERE id = ?', [req.body.role, id]);
      return { id, role: req.body.role };
    },
  );
};

export default userRoutes;
