import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logAdmin } from '@/lib/adminLog';
import { parseId, requireOwner } from '@/lib/guards';
import { periodProperties, periodWhere } from '@/lib/period';
import type { Period } from '@/lib/period';
import { postPath, searchWords } from '@/lib/posts';

const num = (value: unknown) => Number(value ?? 0);
const paging = {
  offset: { type: 'integer', minimum: 0, default: 0 },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
} as const;

/**
 * What the logs keep, as one place to look at and clear (Logs → Clean up): each kind's table, the date that places a
 * row in a period, and (for sign-ins and emailed links) which rows may go at all: only the ended or used ones, never
 * a sign-in or a link that still works.
 */
const HISTORY = {
  adminLog: { table: 'admin_log', date: 'created_at', only: null },
  authLog: { table: 'auth_log', date: 'created_at', only: null },
  sessions: { table: 'sessions', date: 'COALESCE(ended_at, expires_at)', only: '(ended_at IS NOT NULL OR expires_at <= UTC_TIMESTAMP())' },
  emailLog: { table: 'email_log', date: 'created_at', only: null },
  emailLinks: {
    table: 'email_tokens',
    date: 'created_at',
    only: '(used_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at <= UTC_TIMESTAMP())',
  },
  pushLog: { table: 'push_log', date: 'created_at', only: null },
  errorLog: { table: 'error_log', date: 'last_at', only: null },
  commentEdits: { table: 'comment_revisions', date: 'replaced_at', only: null },
} as const;
type HistoryKey = keyof typeof HISTORY;
const HISTORY_KEYS = Object.keys(HISTORY) as HistoryKey[];

/** A kind's rows in the period (and that may go): the condition and its params. */
function inPeriod(key: HistoryKey, period: Period) {
  const part = HISTORY[key];
  const { where, params } = periodWhere(part.date, period);
  if (part.only) where.push(part.only);
  return { where: where.length ? where.join(' AND ') : '1 = 1', params };
}

/** "Name" for a row's account, or null. */
const personOf = (row: RowDataPacket, prefix = 'user') =>
  row[`${prefix}_id`] ? { id: row[`${prefix}_id`] as number, name: (row[`${prefix}_name`] as string | null) ?? `#${row[`${prefix}_id`]}` } : null;

/**
 * The admin panel's logs, in one place (Logs): the server's errors, the pushes sent, the sign-in attempts, the
 * comments' earlier versions; how much each kind holds in a period, and clearing a period. What administrators did
 * and the emails sent are listed in routes/admin.ts (/admin/log, /admin/email-log).
 */
const adminHistoryRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;
  app.addHook('onRequest', requireOwner);

  // ---- How much each kind holds: in the period, in all, and since when.

  app.get<{ Querystring: Period }>(
    '/admin/history/summary',
    { schema: { querystring: { type: 'object', properties: periodProperties } } },
    async (req) => {
      const kinds = [];
      for (const key of HISTORY_KEYS) {
        const part = HISTORY[key];
        const chosen = inPeriod(key, req.query);
        const [[row]] = await db.query<RowDataPacket[]>(
          `SELECT (SELECT COUNT(*) FROM ${part.table} WHERE ${chosen.where}) AS n,
                  (SELECT COUNT(*) FROM ${part.table}${part.only ? ` WHERE ${part.only}` : ''}) AS total,
                  (SELECT MIN(${part.date}) FROM ${part.table}${part.only ? ` WHERE ${part.only}` : ''}) AS oldest`,
          chosen.params,
        );
        kinds.push({ key, count: num(row!.n), total: num(row!.total), oldest: (row!.oldest as Date | null) ?? null });
      }
      return { kinds };
    },
  );

  // ---- Clearing: the chosen kinds' rows in the period (no period: all of them). Noted in the administrators' log
  // (after: clearing that log keeps the note of it).

  app.post<{ Body: Period & { kinds: HistoryKey[] } }>(
    '/admin/history/clear',
    {
      schema: {
        body: {
          type: 'object',
          required: ['kinds'],
          additionalProperties: false,
          properties: {
            kinds: { type: 'array', minItems: 1, maxItems: HISTORY_KEYS.length, uniqueItems: true, items: { type: 'string', enum: HISTORY_KEYS } },
            ...periodProperties,
          },
        },
      },
    },
    async (req) => {
      const { kinds, from, to } = req.body;
      const deleted: Partial<Record<HistoryKey, number>> = {};
      for (const key of kinds) {
        const chosen = inPeriod(key, { from, to });
        const [result] = await db.query<ResultSetHeader>(`DELETE FROM ${HISTORY[key].table} WHERE ${chosen.where}`, chosen.params);
        deleted[key] = result.affectedRows;
      }
      void logAdmin(db, req.user!, 'history.clear', { type: 'settings', id: null, label: [from, to].filter(Boolean).join(' – ') || '*' }, { deleted, from: from ?? null, to: to ?? null });
      return { deleted };
    },
  );

  // ---- The server's errors, the latest first. The first page marks them seen (the menu's count goes).

  app.get<{ Querystring: Period & { source?: string; q?: string; offset: number; limit: number } }>(
    '/admin/history/errors',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { source: { type: 'string', maxLength: 20 }, q: { type: 'string', maxLength: 100 }, ...periodProperties, ...paging },
        },
      },
    },
    async (req) => {
      const { source, q, offset, limit } = req.query;
      const { where, params } = periodWhere('e.last_at', req.query);
      if (source) {
        where.push('e.source = ?');
        params.push(source);
      }
      for (const word of searchWords(q)) {
        where.push('(e.message LIKE ? OR e.context LIKE ?)');
        params.push(word, word);
      }
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT e.*, u.name AS user_name FROM error_log e LEFT JOIN users u ON u.id = e.user_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY e.last_at DESC, e.id DESC LIMIT ? OFFSET ?`,
        [...params, limit + 1, offset],
      );
      const [[counts]] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total, SUM(seen_at IS NULL) AS unseen, SUM(last_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY) AS day FROM error_log`,
      );
      const [sources] = await db.query<RowDataPacket[]>('SELECT source, COUNT(*) AS n FROM error_log GROUP BY source ORDER BY n DESC');
      if (offset === 0) await db.execute('UPDATE error_log SET seen_at = UTC_TIMESTAMP() WHERE seen_at IS NULL');
      return {
        errors: rows.slice(0, limit).map((row) => ({
          id: row.id as number,
          createdAt: row.created_at as Date,
          lastAt: row.last_at as Date,
          times: num(row.times),
          source: row.source as string,
          context: row.context as string,
          message: row.message as string,
          detail: row.detail as string | null,
          user: personOf(row),
          /** Not looked at before this page. */
          seen: row.seen_at !== null,
        })),
        hasMore: rows.length > limit,
        counts: { all: num(counts!.total), unseen: num(counts!.unseen), day: num(counts!.day) },
        sources: sources.map((row) => ({ source: row.source as string, count: num(row.n) })),
      };
    },
  );

  // ---- The pushes sent, the latest first, and the devices that get them.

  app.get<{ Querystring: Period & { kind?: string; user?: number; q?: string; offset: number; limit: number } }>(
    '/admin/history/push',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            kind: { type: 'string', maxLength: 30 },
            user: { type: 'integer', minimum: 1 },
            q: { type: 'string', maxLength: 100 },
            ...periodProperties,
            ...paging,
          },
        },
      },
    },
    async (req) => {
      const { kind, user, q, offset, limit } = req.query;
      const { where, params } = periodWhere('l.created_at', req.query);
      if (kind) {
        where.push('l.kind = ?');
        params.push(kind);
      }
      if (user) {
        where.push('l.user_id = ?');
        params.push(user);
      }
      for (const word of searchWords(q)) {
        where.push('l.title LIKE ?');
        params.push(word);
      }
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT l.*, u.name AS user_name FROM push_log l LEFT JOIN users u ON u.id = l.user_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`,
        [...params, limit + 1, offset],
      );
      const [[devices]] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total, SUM(user_id IS NULL) AS guests, SUM(user_id IS NOT NULL) AS accounts,
                SUM(user_id IS NULL AND new_posts = 1) AS new_posts, SUM(user_id IS NOT NULL AND activity = 1) AS activity,
                (SELECT COUNT(DISTINCT subscription_id) FROM push_books) AS book_devices, (SELECT COUNT(*) FROM push_books) AS book_follows
           FROM push_subscriptions`,
      );
      const [[day]] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS pushes, COALESCE(SUM(sent), 0) AS sent, COALESCE(SUM(failed), 0) AS failed, COALESCE(SUM(gone), 0) AS gone
           FROM push_log WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY`,
      );
      const [kinds] = await db.query<RowDataPacket[]>('SELECT kind, COUNT(*) AS n FROM push_log GROUP BY kind ORDER BY n DESC');
      return {
        pushes: rows.slice(0, limit).map((row) => ({
          id: row.id as number,
          createdAt: row.created_at as Date,
          kind: row.kind as string,
          title: row.title as string,
          url: row.url as string | null,
          user: personOf(row),
          devices: num(row.devices),
          sent: num(row.sent),
          failed: num(row.failed),
          gone: num(row.gone),
          error: row.error as string | null,
        })),
        hasMore: rows.length > limit,
        devices: {
          total: num(devices!.total),
          guests: num(devices!.guests),
          accounts: num(devices!.accounts),
          newPosts: num(devices!.new_posts),
          activity: num(devices!.activity),
          bookDevices: num(devices!.book_devices),
          bookFollows: num(devices!.book_follows),
        },
        day: { pushes: num(day!.pushes), sent: num(day!.sent), failed: num(day!.failed), gone: num(day!.gone) },
        kinds: kinds.map((row) => ({ kind: row.kind as string, count: num(row.n) })),
      };
    },
  );

  // ---- Sign-in attempts, the latest first: all, the ones that worked, or the failed ones (one account's, with `user`).

  app.get<{ Querystring: Period & { outcome?: 'ok' | 'failed'; method?: string; user?: number; q?: string; offset: number; limit: number } }>(
    '/admin/history/auth',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            outcome: { type: 'string', enum: ['ok', 'failed'] },
            method: { type: 'string', enum: ['password', 'google', 'signup', 'reset', 'invite'] },
            user: { type: 'integer', minimum: 1 },
            q: { type: 'string', maxLength: 100 },
            ...periodProperties,
            ...paging,
          },
        },
      },
    },
    async (req) => {
      const { outcome, method, user, q, offset, limit } = req.query;
      const { where: base, params } = periodWhere('a.created_at', req.query);
      if (method) {
        base.push('a.method = ?');
        params.push(method);
      }
      if (user) {
        base.push('a.user_id = ?');
        params.push(user);
      }
      for (const word of searchWords(q)) {
        base.push('(a.email LIKE ? OR u.name LIKE ? OR a.device LIKE ?)');
        params.push(word, word, word);
      }
      const where = [...base, ...(outcome === 'ok' ? ["a.outcome = 'ok'"] : outcome === 'failed' ? ["a.outcome <> 'ok'"] : [])];
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT a.*, u.name AS user_name, COALESCE(u.avatar_url, u.picture) AS user_picture
           FROM auth_log a LEFT JOIN users u ON u.id = a.user_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
        [...params, limit + 1, offset],
      );
      const [[counts]] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total, SUM(a.outcome = 'ok') AS ok, SUM(a.outcome <> 'ok') AS failed
           FROM auth_log a LEFT JOIN users u ON u.id = a.user_id ${base.length ? `WHERE ${base.join(' AND ')}` : ''}`,
        params,
      );
      const [[day]] = await db.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM auth_log WHERE outcome <> 'ok' AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY",
      );
      return {
        attempts: rows.slice(0, limit).map((row) => ({
          id: row.id as number,
          createdAt: row.created_at as Date,
          email: row.email as string | null,
          method: row.method as string,
          outcome: row.outcome as string,
          device: row.device as string | null,
          user: row.user_id ? { id: row.user_id as number, name: (row.user_name as string | null) ?? `#${row.user_id}`, picture: row.user_picture as string | null } : null,
        })),
        hasMore: rows.length > limit,
        counts: { all: num(counts!.total), ok: num(counts!.ok), failed: num(counts!.failed) },
        failedDay: num(day!.n),
      };
    },
  );

  // ---- Comments' earlier versions (kept when a comment is edited, for moderation), the latest first.

  app.get<{ Querystring: Period & { user?: number; q?: string; offset: number; limit: number } }>(
    '/admin/history/edits',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { user: { type: 'integer', minimum: 1 }, q: { type: 'string', maxLength: 100 }, ...periodProperties, ...paging },
        },
      },
    },
    async (req) => {
      const { user, q, offset, limit } = req.query;
      const { where, params } = periodWhere('r.replaced_at', req.query);
      if (user) {
        where.push('m.user_id = ?');
        params.push(user);
      }
      for (const word of searchWords(q)) {
        where.push('(r.body LIKE ? OR m.body LIKE ? OR u.name LIKE ?)');
        params.push(word, word, word);
      }
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT r.id, r.comment_id, r.body AS old_body, r.replaced_at, m.body AS current_body, m.deleted_at, m.edited_at,
                u.id AS user_id, u.name AS user_name, COALESCE(u.avatar_url, u.picture) AS user_picture,
                p.title AS post_title, p.slug AS post_slug, bk.slug AS book_slug
           FROM comment_revisions r
           JOIN comments m ON m.id = r.comment_id
           JOIN users u ON u.id = m.user_id
           JOIN posts p ON p.id = m.post_id
           LEFT JOIN books bk ON bk.id = p.book_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY r.replaced_at DESC, r.id DESC LIMIT ? OFFSET ?`,
        [...params, limit + 1, offset],
      );
      return {
        edits: rows.slice(0, limit).map((row) => ({
          id: row.id as number,
          commentId: row.comment_id as number,
          before: row.old_body as string,
          now: row.current_body as string,
          replacedAt: row.replaced_at as Date,
          deleted: row.deleted_at !== null,
          author: { id: row.user_id as number, name: row.user_name as string, picture: row.user_picture as string | null },
          post: { title: row.post_title as string, path: postPath(row.post_slug as string, (row.book_slug as string | null) ?? null) },
        })),
        hasMore: rows.length > limit,
      };
    },
  );

  // One comment's versions: the earlier ones (oldest first), then the text it has now.
  app.get<{ Params: { id: string } }>('/admin/comments/:id/versions', async (req, reply) => {
    const id = parseId(req.params.id) ?? 0;
    const [[comment]] = await db.execute<RowDataPacket[]>('SELECT id, body, created_at, edited_at FROM comments WHERE id = ?', [id]);
    if (!comment) return reply.code(404).send({ error: 'not_found' });
    const [rows] = await db.execute<RowDataPacket[]>('SELECT body, replaced_at FROM comment_revisions WHERE comment_id = ? ORDER BY replaced_at, id', [id]);
    return {
      createdAt: comment.created_at as Date,
      versions: rows.map((row) => ({ body: row.body as string, replacedAt: row.replaced_at as Date })),
      current: { body: comment.body as string, editedAt: comment.edited_at as Date | null },
    };
  });
};

export default adminHistoryRoutes;
