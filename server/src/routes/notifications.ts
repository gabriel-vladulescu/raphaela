import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { requireUser } from '@/lib/guards';
import { escapeLike } from '@/lib/posts';

const unreadCount = async (app: Parameters<FastifyPluginAsync>[0], userId: number) => {
  const [[row]] = await app.db.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId]);
  return Number(row!.n);
};

/** The page's "type" filter. */
const KINDS = {
  new_posts: ['new_post', 'followed_post'],
  replies_to_me: ['comment_reply'],
  reactions_to_me: ['comment_reaction'],
  mentions: ['mention'],
  comments: ['comment', 'reply'],
  likes: ['like'],
  shares: ['share'],
  reactions: ['post_reaction'],
  views: ['views'],
  milestones: ['milestone'],
  support: ['support', 'support_reply'],
  reports: ['report'],
  accounts: ['account_due', 'cleanup_due'],
  held: ['comment_held'],
} as const;
type Kind = keyof typeof KINDS;

/** Where the next page starts: the last item's time and id ("2026-10-15T12:00:00.000Z_42"), newest first. */
const CURSOR = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z_\\d+$';

interface ListQuery {
  limit: number;
  before?: string;
  type?: Kind;
  unread?: boolean;
  post?: number;
  from?: string;
  to?: string;
}

/** An account's notifications (lib/notifications.ts): newest first, a page at a time, filtered as the page asks. */
const notificationRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get<{ Querystring: ListQuery }>(
    '/notifications',
    {
      preHandler: requireUser,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            before: { type: 'string', pattern: CURSOR },
            type: { type: 'string', enum: Object.keys(KINDS) },
            unread: { type: 'boolean' },
            post: { type: 'integer', minimum: 1 },
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (req) => {
      const userId = req.user!.id;
      const { limit, before, type, unread, post, from, to } = req.query;
      const where = ['n.user_id = ?'];
      const params: unknown[] = [userId];
      if (type) {
        where.push('n.type IN (?)');
        params.push(KINDS[type]);
      }
      if (unread) where.push('n.read_at IS NULL');
      if (post) {
        where.push('n.post_id = ?');
        params.push(post);
      }
      if (from) {
        where.push('n.created_at >= ?');
        params.push(new Date(from));
      }
      if (to) {
        where.push('n.created_at <= ?');
        params.push(new Date(to));
      }
      if (before) {
        const split = before.lastIndexOf('_');
        const time = new Date(before.slice(0, split));
        where.push('(n.created_at < ? OR (n.created_at = ? AND n.id < ?))');
        params.push(time, time, Number(before.slice(split + 1)));
      }

      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT n.id, n.type, n.times, n.detail, n.value, n.created_at, n.read_at,
                p.id AS post_id, p.title AS post_title, p.slug AS post_slug,
                c.id AS comment_id, c.body AS comment_body, c.deleted_at AS comment_deleted_at,
                a.id AS actor_id, a.name AS actor_name, COALESCE(a.avatar_url, a.picture) AS actor_picture,
                t.id AS ticket_id, t.title AS ticket_title, t.email AS ticket_email, acc.id AS account_ref, acc.name AS account_name
           FROM notifications n
           LEFT JOIN posts p ON p.id = n.post_id
           LEFT JOIN comments c ON c.id = n.comment_id
           LEFT JOIN users a ON a.id = n.actor_id AND a.deleted_at IS NULL
           LEFT JOIN users acc ON acc.id = n.account_id
           LEFT JOIN support_tickets t ON t.id = n.ticket_id
          WHERE ${where.join(' AND ')}
          ORDER BY n.created_at DESC, n.id DESC
          LIMIT ?`,
        [...params, limit + 1],
      );
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];

      // The picked post's title, for the filter's label (only one of the viewer's own notifications' posts).
      const [picked] = post
        ? await db.query<RowDataPacket[]>(
            'SELECT p.id, p.title FROM posts p WHERE p.id = ? AND EXISTS (SELECT 1 FROM notifications n WHERE n.post_id = p.id AND n.user_id = ?)',
            [post, userId],
          )
        : [[] as RowDataPacket[]];

      return {
        notifications: page.map((row) => ({
          id: Number(row.id),
          type: row.type as string,
          times: row.times as number,
          detail: row.detail as string | null,
          value: row.value as number | null,
          createdAt: row.created_at as Date,
          read: row.read_at !== null,
          post: row.post_id ? { id: row.post_id as number, title: row.post_title as string, slug: row.post_slug as string } : null,
          comment: row.comment_id
            ? { id: row.comment_id as number, body: row.comment_deleted_at ? null : String(row.comment_body).slice(0, 200) }
            : null,
          actor: row.actor_id ? { id: row.actor_id as number, name: row.actor_name as string, picture: row.actor_picture as string | null } : null,
          ticket: row.ticket_id ? { id: row.ticket_id as number, title: row.ticket_title as string, email: row.ticket_email as string } : null,
          /** A deleted account waiting to be deleted for good (administrators). */
          account: row.account_ref ? { id: row.account_ref as number, name: row.account_name as string } : null,
        })),
        /** Pass as `before` for the next page; null at the end. */
        next: rows.length > limit && last ? `${(last.created_at as Date).toISOString()}_${last.id}` : null,
        unread: await unreadCount(app, userId),
        post: picked[0] ? { id: picked[0].id as number, title: picked[0].title as string } : null,
      };
    },
  );

  /** The posts the viewer's notifications are about (the page's article filter): latest activity first, searchable. */
  app.get<{ Querystring: { q?: string; offset: number; limit: number } }>(
    '/notifications/posts',
    {
      preHandler: requireUser,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 100 },
            offset: { type: 'integer', minimum: 0, default: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        },
      },
    },
    async (req) => {
      const { offset, limit } = req.query;
      const q = req.query.q?.trim();
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT p.id, p.title, COUNT(*) AS total, SUM(n.read_at IS NULL) AS unread, MAX(n.created_at) AS latest
           FROM notifications n JOIN posts p ON p.id = n.post_id
          WHERE n.user_id = ?${q ? ' AND p.title LIKE ?' : ''}
          GROUP BY p.id, p.title
          ORDER BY latest DESC, p.id DESC
          LIMIT ? OFFSET ?`,
        [req.user!.id, ...(q ? [`%${escapeLike(q)}%`] : []), limit + 1, offset],
      );
      return {
        posts: rows.slice(0, limit).map((row) => ({ id: row.id as number, title: row.title as string, total: Number(row.total), unread: Number(row.unread) })),
        hasMore: rows.length > limit,
      };
    },
  );

  app.get('/notifications/unread', { preHandler: requireUser }, async (req) => ({ unread: await unreadCount(app, req.user!.id) }));

  // Marks some (ids) or all as read.
  app.post<{ Body: { ids?: number[] } }>(
    '/notifications/read',
    {
      preHandler: requireUser,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { ids: { type: 'array', maxItems: 200, items: { type: 'integer', minimum: 1 } } },
        },
      },
    },
    async (req) => {
      const userId = req.user!.id;
      const ids = req.body.ids;
      if (ids?.length) {
        await db.query('UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND read_at IS NULL AND id IN (?)', [userId, ids]);
      } else if (!ids) {
        await db.execute('UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND read_at IS NULL', [userId]);
      }
      return { unread: await unreadCount(app, userId) };
    },
  );
};

export default notificationRoutes;
