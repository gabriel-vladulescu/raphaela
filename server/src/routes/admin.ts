import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '@/config';
import { finalizeAccountDeletion, liftSuspension, restoreAccount, RETENTION_MONTHS, suspendAccount, SUSPENDED_NOW } from '@/lib/accounts';
import { commentLabel, logAdmin } from '@/lib/adminLog';
import type { AdminTarget } from '@/lib/adminLog';
import { siteDay, siteDayStart } from '@/lib/analytics';
import { testEmail } from '@/lib/emails';
import { parseId, requireOwner } from '@/lib/guards';
import { mailConfigured, mailSettings, saveMailSettings, sendTestMail } from '@/lib/mail';
import type { SmtpSettings } from '@/lib/mail';
import { escapeLike } from '@/lib/posts';
import { siteSettings } from '@/lib/siteSettings';

const DAY_MS = 24 * 60 * 60 * 1000;
const num = (value: unknown) => Number(value ?? 0);

const paging = {
  offset: { type: 'integer', minimum: 0, default: 0 },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
} as const;

/** `LIKE` patterns for each word of a search (at most 6 words). */
const searchWords = (q: string | undefined) =>
  (q ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((word) => `%${escapeLike(word)}%`);

// ---- Users

/** A deleted account whose RETENTION_MONTHS are up: an administrator can delete it for good. */
const DELETION_DUE = `(u.deleted_at IS NOT NULL AND u.deleted_at <= UTC_TIMESTAMP() - INTERVAL ${RETENTION_MONTHS} MONTH)`;

const USER_STATUS = {
  active: `u.deleted_at IS NULL AND NOT ${SUSPENDED_NOW}`,
  suspended: `u.deleted_at IS NULL AND ${SUSPENDED_NOW}`,
  deleted: 'u.deleted_at IS NOT NULL',
  due: DELETION_DUE,
  unverified: 'u.deleted_at IS NULL AND u.email_verified_at IS NULL',
} as const;
type UserStatus = keyof typeof USER_STATUS;

const USER_COLUMNS = `u.id, u.name, u.email, u.username, COALESCE(u.avatar_url, u.picture) AS picture, u.role, u.created_at,
  u.last_login_at, u.email_verified_at, u.google_id IS NOT NULL AS google, u.password_hash IS NOT NULL AS has_password,
  u.deleted_at, DATE_ADD(u.deleted_at, INTERVAL ${RETENTION_MONTHS} MONTH) AS purge_on, ${SUSPENDED_NOW} AS suspended_now,
  u.suspended_at, u.suspended_until, u.suspension_reason, u.deletion_comments, u.deletion_posts, ${DELETION_DUE} AS deletion_due,
  (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS post_count,
  (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id) AS all_post_count,
  (SELECT COUNT(*) FROM comments m WHERE m.user_id = u.id AND m.deleted_at IS NULL) AS comment_count`;

function toAdminUser(row: RowDataPacket) {
  return {
    id: row.id as number,
    name: row.name as string,
    email: row.email as string,
    username: row.username as string | null,
    picture: row.picture as string | null,
    role: row.role as 'member' | 'author' | 'owner',
    createdAt: row.created_at as Date,
    lastLoginAt: row.last_login_at as Date | null,
    emailVerified: row.email_verified_at !== null,
    google: Boolean(row.google),
    hasPassword: Boolean(row.has_password),
    deletedAt: row.deleted_at as Date | null,
    purgeOn: row.purge_on as Date | null,
    /** Deleted: what they chose for their comments and (authors) posts, and whether it can be deleted for good now. */
    deletion: row.deleted_at
      ? {
          comments: (row.deletion_comments as 'keep' | 'delete' | null) ?? 'keep',
          posts: (row.deletion_posts as 'keep' | 'delete' | null) ?? null,
          due: Boolean(Number(row.deletion_due)),
          /** Every post they wrote (to move to another author, or to delete for good). */
          postsTotal: num(row.all_post_count),
        }
      : null,
    suspension: Number(row.suspended_now)
      ? { since: row.suspended_at as Date, until: row.suspended_until as Date | null, reason: row.suspension_reason as string | null }
      : null,
    postCount: num(row.post_count),
    commentCount: num(row.comment_count),
  };
}

// ---- Comments

const COMMENT_FILTER = {
  all: '1 = 1',
  held: 'm.held_at IS NOT NULL AND m.deleted_at IS NULL',
  reported: 'EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = m.id AND r.resolved_at IS NULL)',
  deleted: 'm.deleted_at IS NOT NULL',
} as const;
type CommentFilter = keyof typeof COMMENT_FILTER;

// ---- Posts

const POST_STATUS = {
  all: 'p.deleted_at IS NULL',
  featured: 'p.deleted_at IS NULL AND p.featured_at IS NOT NULL',
  published: "p.deleted_at IS NULL AND p.status = 'published' AND p.published_at <= UTC_TIMESTAMP()",
  scheduled: "p.deleted_at IS NULL AND p.status = 'published' AND p.published_at > UTC_TIMESTAMP()",
  draft: "p.deleted_at IS NULL AND p.status = 'draft'",
  deleted: 'p.deleted_at IS NOT NULL',
} as const;
type PostStatusFilter = keyof typeof POST_STATUS;
const POST_SORT = {
  new: 'COALESCE(p.published_at, p.created_at) DESC, p.id DESC',
  updated: 'p.updated_at DESC, p.id DESC',
  views: 'p.view_count DESC, p.id DESC',
  likes: 'likes DESC, p.id DESC',
  comments: 'comments DESC, p.id DESC',
} as const;

/** What the SMTP settings look like to the admin panel: everything but the password (only whether there is one). */
const publicMailSettings = () => {
  const { password, ...rest } = mailSettings();
  return { ...rest, hasPassword: password !== '' };
};

/**
 * The admin panel (/admin, administrators only): its overview, people (roles, suspensions, deleted accounts),
 * comment moderation (reports), every post, and the site's email (SMTP) settings. Support tickets are in
 * routes/support.ts, statistics in routes/stats.ts, categories in routes/categories.ts.
 */
const adminRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;
  // Every route in this plugin (Fastify keeps the hook to it).
  app.addHook('onRequest', requireOwner); // before the body is validated

  app.get('/admin/overview', async () => {
    const weekFrom = siteDay(new Date(Date.now() - 6 * DAY_MS));
    const [[row]] = await db.query<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM support_tickets) AS tickets,
              (SELECT COUNT(*) FROM support_tickets WHERE seen_at IS NULL) AS tickets_new,
              (SELECT COUNT(DISTINCT comment_id) FROM comment_reports WHERE resolved_at IS NULL) AS reports_open,
              (SELECT COUNT(*) FROM comments WHERE held_at IS NOT NULL AND deleted_at IS NULL) AS comments_held,
              (SELECT COUNT(*) FROM newsletter_subscribers WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL) AS subscribers,
              (SELECT COUNT(*) FROM invites WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()) AS invites_pending,
              (SELECT COUNT(*) FROM posts WHERE deleted_at IS NULL AND status = 'published' AND published_at <= UTC_TIMESTAMP()) AS published,
              (SELECT COUNT(*) FROM posts WHERE deleted_at IS NULL AND status = 'published' AND published_at > UTC_TIMESTAMP()) AS scheduled,
              (SELECT COUNT(*) FROM posts WHERE deleted_at IS NULL AND status = 'draft') AS drafts,
              (SELECT COUNT(*) FROM categories) AS categories,
              (SELECT COUNT(*) FROM categories WHERE parent_id IS NULL) AS top_categories,
              (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL) AS users,
              (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND role = 'author') AS authors,
              (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY) AS users_week,
              (SELECT COUNT(*) FROM users u WHERE u.deleted_at IS NULL AND ${SUSPENDED_NOW}) AS suspended,
              (SELECT COUNT(*) FROM users WHERE deleted_at IS NOT NULL AND purged_at IS NULL) AS deleted_pending,
              (SELECT COUNT(*) FROM users u WHERE u.purged_at IS NULL AND ${DELETION_DUE}) AS deletion_due,
              (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND email_verified_at IS NULL) AS unverified,
              (SELECT COUNT(*) FROM comments WHERE deleted_at IS NULL) AS comments,
              (SELECT COUNT(*) FROM comments WHERE deleted_at IS NULL AND created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY) AS comments_week,
              (SELECT COUNT(*) FROM page_views WHERE day >= ?) AS week_views,
              (SELECT COUNT(DISTINCT visitor_id) FROM page_views WHERE day >= ?) AS week_visitors,
              (SELECT COUNT(*) FROM email_log WHERE status = 'sent' AND created_at >= ?) AS mail_sent_today,
              (SELECT COUNT(*) FROM email_log WHERE status = 'failed' AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY) AS mail_failed_24h`,
      [weekFrom, weekFrom, siteDayStart(siteDay())],
    );
    return {
      tickets: { total: num(row!.tickets), unseen: num(row!.tickets_new) },
      reports: { open: num(row!.reports_open) },
      held: num(row!.comments_held),
      newsletter: { subscribers: num(row!.subscribers) },
      invites: { pending: num(row!.invites_pending) },
      maintenance: siteSettings().maintenance,
      posts: { published: num(row!.published), scheduled: num(row!.scheduled), drafts: num(row!.drafts) },
      categories: { total: num(row!.categories), top: num(row!.top_categories) },
      users: {
        total: num(row!.users),
        authors: num(row!.authors),
        week: num(row!.users_week),
        suspended: num(row!.suspended),
        deletedPending: num(row!.deleted_pending),
        deletionDue: num(row!.deletion_due),
        unverified: num(row!.unverified),
      },
      comments: { total: num(row!.comments), week: num(row!.comments_week) },
      week: { views: num(row!.week_views), visitors: num(row!.week_visitors) },
      mail: {
        configured: mailConfigured(),
        production: config.production,
        sentToday: num(row!.mail_sent_today),
        failed24h: num(row!.mail_failed_24h),
        dailyLimit: mailSettings().dailyLimit,
      },
    };
  });

  // ---- People

  app.get<{ Querystring: { q?: string; role?: string; status?: UserStatus | 'all'; sort: 'new' | 'name' | 'login'; offset: number; limit: number } }>(
    '/admin/users',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 100 },
            role: { type: 'string', enum: ['member', 'author', 'owner'] },
            status: { type: 'string', enum: ['all', ...Object.keys(USER_STATUS)] },
            sort: { type: 'string', enum: ['new', 'name', 'login'], default: 'new' },
            ...paging,
          },
        },
      },
    },
    async (req) => {
      const { q, role, status, sort, offset, limit } = req.query;
      // Without the status: everyone (anonymised accounts, long gone, never show).
      const base: string[] = ['u.purged_at IS NULL'];
      const params: unknown[] = [];
      for (const word of searchWords(q)) {
        base.push('(u.name LIKE ? OR u.email LIKE ? OR u.username LIKE ?)');
        params.push(word, word, word);
      }
      if (role) {
        base.push('u.role = ?');
        params.push(role);
      }
      const where = [...base, ...(status && status !== 'all' ? [USER_STATUS[status]] : [])].join(' AND ');
      const order = { new: 'u.created_at DESC, u.id DESC', name: 'u.name, u.id', login: 'u.last_login_at DESC, u.id DESC' }[sort];
      const [rows] = await db.query<RowDataPacket[]>(`SELECT ${USER_COLUMNS} FROM users u WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, [
        ...params,
        limit + 1,
        offset,
      ]);
      // How many in each status tab (with the same search and role).
      const [[counts]] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS all_count, ${Object.entries(USER_STATUS)
          .map(([key, sql]) => `SUM(${sql}) AS ${key}`)
          .join(', ')}
           FROM users u WHERE ${base.join(' AND ')}`,
        params,
      );
      return {
        users: rows.slice(0, limit).map(toAdminUser),
        hasMore: rows.length > limit,
        counts: {
          all: num(counts!.all_count),
          ...Object.fromEntries(Object.keys(USER_STATUS).map((key) => [key, num(counts![key])])),
        },
      };
    },
  );

  app.get<{ Params: { id: string } }>('/admin/users/:id', async (req, reply) => {
    const id = parseId(req.params.id) ?? 0;
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ${USER_COLUMNS}, u.occupation, u.quote, u.terms_accepted_at, b.name AS suspended_by_name,
              (SELECT COUNT(*) FROM post_likes l WHERE l.user_id = u.id AND l.removed_at IS NULL) AS like_count,
              (SELECT COUNT(*) FROM comment_reports r WHERE r.reporter_id = u.id) AS reports_made,
              (SELECT COUNT(*) FROM comment_reports r JOIN comments m ON m.id = r.comment_id WHERE m.user_id = u.id) AS reports_received,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > UTC_TIMESTAMP()) AS sessions,
              (SELECT COUNT(*) FROM comments m WHERE m.deleted_with_account = u.id) AS comments_with_account,
              (SELECT COUNT(*) FROM posts p WHERE p.deleted_with_account = u.id) AS posts_with_account
         FROM users u LEFT JOIN users b ON b.id = u.suspended_by
        WHERE u.id = ? AND u.purged_at IS NULL`,
      [id],
    );
    const row = rows[0];
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const [comments] = await db.query<RowDataPacket[]>(
      `SELECT m.id, m.body, m.created_at, m.deleted_at, p.title AS post_title, p.slug AS post_slug,
              (SELECT COUNT(*) FROM comment_reports r WHERE r.comment_id = m.id AND r.resolved_at IS NULL) AS open_reports
         FROM comments m JOIN posts p ON p.id = m.post_id
        WHERE m.user_id = ? ORDER BY m.created_at DESC LIMIT 10`,
      [id],
    );
    const base = toAdminUser(row);
    return {
      user: {
        ...base,
        occupation: row.occupation as string | null,
        quote: row.quote as string | null,
        termsAcceptedAt: row.terms_accepted_at as Date | null,
        suspension: base.suspension ? { ...base.suspension, by: (row.suspended_by_name as string | null) ?? null } : null,
        likeCount: num(row.like_count),
        reportsMade: num(row.reports_made),
        reportsReceived: num(row.reports_received),
        sessions: num(row.sessions),
        /** Deleted with the account, as they chose: these comments (theirs and the replies under them) and posts. */
        deletedWithAccount: { comments: num(row.comments_with_account), posts: num(row.posts_with_account) },
      },
      comments: comments.map((c) => ({
        id: c.id as number,
        body: String(c.body).slice(0, 300),
        createdAt: c.created_at as Date,
        deleted: c.deleted_at !== null,
        post: { title: c.post_title as string, slug: c.post_slug as string },
        openReports: num(c.open_reports),
      })),
    };
  });

  /** A person, as the log names them then: "Name (email)". */
  const userTarget = async (id: number | null): Promise<AdminTarget> => {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT name, email FROM users WHERE id = ?', [id ?? 0]);
    return { type: 'user', id, label: rows[0] ? `${rows[0].name as string} (${rows[0].email as string})` : `#${id}` };
  };

  /** The account for a change by an administrator: not their own, not another administrator's, not deleted. */
  const changeable = async (id: number | null, me: number) => {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT role, deleted_at FROM users WHERE id = ? AND purged_at IS NULL', [id ?? 0]);
    const row = rows[0];
    if (!row) return { status: 404, error: 'not_found' } as const;
    if (row.role === 'owner' || id === me) return { status: 403, error: 'role_locked' } as const;
    if (row.deleted_at) return { status: 409, error: 'account_deleted' } as const;
    return null;
  };

  // Gives or takes the author role. The owner role comes from OWNER_EMAILS, so it isn't changed here.
  app.patch<{ Params: { id: string }; Body: { role: 'member' | 'author' } }>(
    '/admin/users/:id/role',
    {
      schema: {
        body: { type: 'object', required: ['role'], additionalProperties: false, properties: { role: { type: 'string', enum: ['member', 'author'] } } },
      },
    },
    async (req, reply) => {
      const id = parseId(req.params.id);
      const problem = await changeable(id, req.user!.id);
      if (problem) return reply.code(problem.status).send({ error: problem.error });
      const [[before]] = await db.execute<RowDataPacket[]>('SELECT role FROM users WHERE id = ?', [id]);
      await db.execute('UPDATE users SET role = ? WHERE id = ?', [req.body.role, id]);
      if (before!.role !== req.body.role) void logAdmin(db, req.user!, 'user.role', await userTarget(id), { from: before!.role, to: req.body.role });
      return { id, role: req.body.role };
    },
  );

  // Suspends an account for `days` (null: until lifted), with a reason the person sees when they try to sign in.
  app.post<{ Params: { id: string }; Body: { days: number | null; reason?: string } }>(
    '/admin/users/:id/suspend',
    {
      schema: {
        body: {
          type: 'object',
          required: ['days'],
          additionalProperties: false,
          properties: { days: { type: ['integer', 'null'], minimum: 1, maximum: 3650 }, reason: { type: 'string', maxLength: 500 } },
        },
      },
    },
    async (req, reply) => {
      const id = parseId(req.params.id);
      const problem = await changeable(id, req.user!.id);
      if (problem) return reply.code(problem.status).send({ error: problem.error });
      await suspendAccount(db, id!, req.user!.id, req.body.days, req.body.reason?.trim() || null);
      void logAdmin(db, req.user!, 'user.suspend', await userTarget(id), { days: req.body.days, reason: req.body.reason?.trim() || null });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/admin/users/:id/suspend', async (req, reply) => {
    const id = parseId(req.params.id);
    const problem = await changeable(id, req.user!.id);
    if (problem) return reply.code(problem.status).send({ error: problem.error });
    await liftSuspension(db, id!);
    void logAdmin(db, req.user!, 'user.lift', await userTarget(id));
    return { ok: true };
  });

  // Restores a deleted account before it's gone for good (after a support ticket, say). The person gets an email.
  app.post<{ Params: { id: string } }>('/admin/users/:id/restore', async (req, reply) => {
    const id = parseId(req.params.id) ?? 0;
    if (!(await restoreAccount(db, id))) return reply.code(404).send({ error: 'not_found' });
    void logAdmin(db, req.user!, 'user.restore', await userTarget(id));
    return { ok: true };
  });

  // Deletes an account for good, once its months are up, as its person chose (lib/accounts.ts). An author's posts
  // they chose to keep move to another author (`transferTo`).
  app.post<{ Params: { id: string }; Body: { transferTo?: number | null } }>(
    '/admin/users/:id/finalize',
    {
      schema: {
        body: { type: 'object', additionalProperties: false, properties: { transferTo: { type: ['integer', 'null'], minimum: 1 } } },
      },
    },
    async (req, reply) => {
      const id = parseId(req.params.id) ?? 0;
      // Named before: afterwards the account has no name.
      const target = await userTarget(id);
      const [[choices]] = await db.execute<RowDataPacket[]>('SELECT deletion_comments, deletion_posts FROM users WHERE id = ?', [id]);
      const transferTo = req.body?.transferTo ?? null;
      const result = await finalizeAccountDeletion(db, id, transferTo);
      if (!result.ok) return reply.code(result.status).send({ error: result.error });
      void logAdmin(db, req.user!, 'user.finalize', target, {
        comments: choices?.deletion_comments ?? null,
        posts: choices?.deletion_posts ?? null,
        transferTo: transferTo ? (await userTarget(transferTo)).label : null,
      });
      return { ok: true };
    },
  );

  // People for the admin panel's searchable menus: a few at a time, by name or email. `role`: only these
  // ('writer': authors and administrators); `posts`: only people who wrote posts; `active`: not deleted or suspended.
  app.get<{ Querystring: { q?: string; role?: 'member' | 'author' | 'owner' | 'writer'; posts?: boolean; active?: boolean; exclude?: number; limit: number } }>(
    '/admin/lookup/users',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 100 },
            role: { type: 'string', enum: ['member', 'author', 'owner', 'writer'] },
            posts: { type: 'boolean' },
            active: { type: 'boolean' },
            exclude: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
          },
        },
      },
    },
    async (req) => {
      const { q, role, posts, active, exclude, limit } = req.query;
      const where = ['u.purged_at IS NULL'];
      const params: unknown[] = [];
      for (const word of searchWords(q)) {
        where.push('(u.name LIKE ? OR u.email LIKE ? OR u.username LIKE ?)');
        params.push(word, word, word);
      }
      if (role === 'writer') where.push("u.role IN ('author', 'owner')");
      else if (role) {
        where.push('u.role = ?');
        params.push(role);
      }
      if (posts) where.push('EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.id)');
      if (active) where.push(`u.deleted_at IS NULL AND NOT ${SUSPENDED_NOW}`);
      if (exclude) {
        where.push('u.id <> ?');
        params.push(exclude);
      }
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT u.id, u.name, u.email, COALESCE(u.avatar_url, u.picture) AS picture, u.role, u.deleted_at IS NOT NULL AS deleted,
                (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS posts
           FROM users u WHERE ${where.join(' AND ')}
          ORDER BY u.name, u.id LIMIT ?`,
        [...params, limit + 1],
      );
      return {
        users: rows.slice(0, limit).map((row) => ({
          id: row.id as number,
          name: row.name as string,
          email: row.email as string,
          picture: row.picture as string | null,
          role: row.role as string,
          deleted: Boolean(row.deleted),
          posts: num(row.posts),
        })),
        hasMore: rows.length > limit,
      };
    },
  );

  // One person by id (a searchable menu showing what's picked, e.g. from the address).
  app.get<{ Params: { id: string } }>('/admin/lookup/users/:id', async (req, reply) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT id, name, email, COALESCE(avatar_url, picture) AS picture, role FROM users WHERE id = ? AND purged_at IS NULL',
      [parseId(req.params.id) ?? 0],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
    const row = rows[0];
    return { user: { id: row.id as number, name: row.name as string, email: row.email as string, picture: row.picture as string | null, role: row.role as string } };
  });

  // Marks an address as confirmed (when the administrator knows it's theirs, e.g. the email never arrived).
  app.post<{ Params: { id: string } }>('/admin/users/:id/verify-email', async (req, reply) => {
    const [result] = await db.execute<ResultSetHeader>(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = ? AND deleted_at IS NULL',
      [parseId(req.params.id) ?? 0],
    );
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'not_found' });
    void logAdmin(db, req.user!, 'user.verify_email', await userTarget(parseId(req.params.id)));
    return { ok: true };
  });

  // ---- Comments and their reports (deleting one is DELETE /comments/:id, which also settles its reports)

  app.get<{ Querystring: { filter: CommentFilter; q?: string; user?: number; offset: number; limit: number } }>(
    '/admin/comments',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            filter: { type: 'string', enum: Object.keys(COMMENT_FILTER), default: 'all' },
            q: { type: 'string', maxLength: 100 },
            user: { type: 'integer', minimum: 1 },
            ...paging,
          },
        },
      },
    },
    async (req) => {
      const { filter, q, user, offset, limit } = req.query;
      const base: string[] = [];
      const params: unknown[] = [];
      for (const word of searchWords(q)) {
        base.push('(m.body LIKE ? OR u.name LIKE ? OR p.title LIKE ?)');
        params.push(word, word, word);
      }
      if (user) {
        base.push('m.user_id = ?');
        params.push(user);
      }
      const where = [...base, COMMENT_FILTER[filter]].join(' AND ');
      // Reported ones: the most recently reported first.
      const order =
        filter === 'held'
          ? 'm.held_at, m.id'
          : filter === 'reported'
          ? '(SELECT MAX(r.created_at) FROM comment_reports r WHERE r.comment_id = m.id AND r.resolved_at IS NULL) DESC, m.id DESC'
          : 'm.created_at DESC, m.id DESC';
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT m.id, m.body, m.parent_id, m.created_at, m.edited_at, m.deleted_at, m.held_at, m.held_reason, d.name AS deleted_by_name,
                p.id AS post_id, p.title AS post_title, p.slug AS post_slug,
                u.id AS author_id, u.name AS author_name, COALESCE(u.avatar_url, u.picture) AS author_picture,
                u.deleted_at IS NOT NULL AS author_deleted, ${SUSPENDED_NOW} AS author_suspended, u.role AS author_role,
                (SELECT COUNT(*) FROM comments r WHERE r.parent_id = m.id AND r.deleted_at IS NULL) AS replies,
                (SELECT COUNT(*) FROM comment_reports r WHERE r.comment_id = m.id AND r.resolved_at IS NULL) AS open_reports
           FROM comments m
           JOIN posts p ON p.id = m.post_id
           JOIN users u ON u.id = m.user_id
           LEFT JOIN users d ON d.id = m.deleted_by
          WHERE ${where}
          ORDER BY ${order}
          LIMIT ? OFFSET ?`,
        [...params, limit + 1, offset],
      );
      const page = rows.slice(0, limit);
      const ids = page.map((row) => row.id as number);
      const [reports] = ids.length
        ? await db.query<RowDataPacket[]>(
            `SELECT r.comment_id, r.reason, r.details, r.created_at, ru.id AS reporter_id, ru.name AS reporter_name
               FROM comment_reports r LEFT JOIN users ru ON ru.id = r.reporter_id
              WHERE r.comment_id IN (?) AND r.resolved_at IS NULL
              ORDER BY r.created_at DESC`,
            [ids],
          )
        : [[] as RowDataPacket[]];
      const where0 = base.length ? base.join(' AND ') : '1 = 1';
      const [[counts]] = await db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS all_count, SUM(${COMMENT_FILTER.held}) AS held, SUM(${COMMENT_FILTER.reported}) AS reported, SUM(${COMMENT_FILTER.deleted}) AS deleted
           FROM comments m JOIN posts p ON p.id = m.post_id JOIN users u ON u.id = m.user_id WHERE ${where0}`,
        params,
      );
      return {
        comments: page.map((row) => ({
          id: row.id as number,
          body: row.body as string,
          isReply: row.parent_id !== null,
          createdAt: row.created_at as Date,
          editedAt: row.edited_at as Date | null,
          deletedAt: row.deleted_at as Date | null,
          deletedBy: (row.deleted_by_name as string | null) ?? null,
          /** Waiting for approval (the comment filters), and why: a blocked word, a link, a new account's first. */
          held: row.held_at ? ((row.held_reason as string | null) ?? 'first') : null,
          post: { id: row.post_id as number, title: row.post_title as string, slug: row.post_slug as string },
          author: {
            id: row.author_id as number,
            name: row.author_name as string,
            picture: row.author_picture as string | null,
            role: row.author_role as string,
            deleted: Boolean(row.author_deleted),
            suspended: Boolean(Number(row.author_suspended)),
          },
          replies: num(row.replies),
          reports: reports
            .filter((r) => r.comment_id === row.id)
            .map((r) => ({
              reason: r.reason as string,
              details: r.details as string | null,
              createdAt: r.created_at as Date,
              reporter: r.reporter_id ? { id: r.reporter_id as number, name: r.reporter_name as string } : null,
            })),
        })),
        hasMore: rows.length > limit,
        counts: { all: num(counts!.all_count), held: num(counts!.held), reported: num(counts!.reported), deleted: num(counts!.deleted) },
      };
    },
  );

  // The reports were looked at and the comment stays.
  app.post<{ Params: { id: string } }>('/admin/comments/:id/keep', async (req) => {
    const id = parseId(req.params.id) ?? 0;
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE comment_reports SET resolved_at = UTC_TIMESTAMP(), resolved_by = ?, resolution = 'kept' WHERE comment_id = ? AND resolved_at IS NULL`,
      [req.user!.id, id],
    );
    if (result.affectedRows > 0) {
      const [[comment]] = await db.execute<RowDataPacket[]>('SELECT body FROM comments WHERE id = ?', [id]);
      void logAdmin(db, req.user!, 'comment.keep', { type: 'comment', id, label: commentLabel(String(comment?.body ?? '')) }, { reports: result.affectedRows });
    }
    return { ok: true };
  });

  // ---- Posts: every one, with its numbers (writing and editing happen in the site's editor)

  app.get<{ Querystring: { status: PostStatusFilter; q?: string; author?: number; sort: keyof typeof POST_SORT; offset: number; limit: number } }>(
    '/admin/posts',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: Object.keys(POST_STATUS), default: 'all' },
            q: { type: 'string', maxLength: 100 },
            author: { type: 'integer', minimum: 1 },
            sort: { type: 'string', enum: Object.keys(POST_SORT), default: 'new' },
            ...paging,
          },
        },
      },
    },
    async (req) => {
      const { status, q, author, sort, offset, limit } = req.query;
      const base: string[] = [];
      const params: unknown[] = [];
      for (const word of searchWords(q)) {
        base.push('(p.title LIKE ? OR p.excerpt LIKE ?)');
        params.push(word, word);
      }
      if (author) {
        base.push('p.author_id = ?');
        params.push(author);
      }
      const where = [...base, POST_STATUS[status]].join(' AND ');
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT p.id, p.slug, p.title, p.status, p.published_at, p.created_at, p.updated_at, p.deleted_at, p.view_count,
                p.comments_enabled, p.banner_url, p.featured_at, c.name AS category_name,
                u.id AS author_id, u.name AS author_name, u.username AS author_username,
                COALESCE(u.avatar_url, u.picture) AS author_picture, u.deleted_at IS NOT NULL AS author_deleted,
                (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id AND l.removed_at IS NULL) AS likes,
                (SELECT COUNT(*) FROM comments m WHERE m.post_id = p.id AND m.deleted_at IS NULL) AS comments
           FROM posts p
           JOIN users u ON u.id = p.author_id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE ${where}
          ORDER BY ${POST_SORT[sort]}
          LIMIT ? OFFSET ?`,
        [...params, limit + 1, offset],
      );
      const [[counts]] = await db.query<RowDataPacket[]>(
        `SELECT ${Object.entries(POST_STATUS)
          .map(([key, sql]) => `SUM(${sql}) AS \`${key}\``)
          .join(', ')}
           FROM posts p WHERE ${base.length ? base.join(' AND ') : '1 = 1'}`,
        params,
      );
      const now = Date.now();
      return {
        posts: rows.slice(0, limit).map((row) => {
          const publishedAt = row.published_at as Date | null;
          return {
            id: row.id as number,
            slug: row.slug as string,
            title: row.title as string,
            status: row.deleted_at
              ? 'deleted'
              : row.status === 'draft'
                ? 'draft'
                : publishedAt && publishedAt.getTime() > now
                  ? 'scheduled'
                  : 'published',
            publishedAt,
            createdAt: row.created_at as Date,
            updatedAt: row.updated_at as Date,
            bannerUrl: row.banner_url as string | null,
            category: row.category_name as string | null,
            commentsEnabled: Boolean(row.comments_enabled),
            featured: row.featured_at !== null,
            author: {
              id: row.author_id as number,
              name: row.author_name as string,
              username: row.author_username as string | null,
              picture: row.author_picture as string | null,
              deleted: Boolean(row.author_deleted),
            },
            views: num(row.view_count),
            likes: num(row.likes),
            comments: num(row.comments),
          };
        }),
        hasMore: rows.length > limit,
        counts: Object.fromEntries(Object.keys(POST_STATUS).map((key) => [key, num(counts![key])])),
      };
    },
  );

  /** A post, as the log names it. */
  const postTarget = async (id: number): Promise<AdminTarget> => {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT title FROM posts WHERE id = ?', [id]);
    return { type: 'post', id, label: (rows[0]?.title as string | undefined) ?? `#${id}` };
  };

  app.delete<{ Params: { id: string } }>('/admin/posts/:id', async (req, reply) => {
    const id = parseId(req.params.id) ?? 0;
    const [result] = await db.execute<ResultSetHeader>('UPDATE posts SET deleted_at = UTC_TIMESTAMP() WHERE id = ? AND deleted_at IS NULL', [id]);
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'not_found' });
    void logAdmin(db, req.user!, 'post.delete', await postTarget(id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/admin/posts/:id/restore', async (req, reply) => {
    const id = parseId(req.params.id) ?? 0;
    const [result] = await db.execute<ResultSetHeader>('UPDATE posts SET deleted_at = NULL, deleted_with_account = NULL WHERE id = ? AND deleted_at IS NOT NULL', [id]);
    if (result.affectedRows === 0) return reply.code(404).send({ error: 'not_found' });
    void logAdmin(db, req.user!, 'post.restore', await postTarget(id));
    return { ok: true };
  });

  // ---- Email (SMTP)

  app.get('/admin/settings/email', async () => ({
    settings: publicMailSettings(),
    configured: mailConfigured(),
    production: config.production,
  }));

  const smtpSchema = {
    type: 'object',
    required: ['host', 'port', 'security', 'user', 'fromEmail', 'fromName'],
    additionalProperties: false,
    properties: {
      host: { type: 'string', maxLength: 255 },
      port: { type: 'integer', minimum: 1, maximum: 65535 },
      security: { type: 'string', enum: ['tls', 'starttls', 'none'] },
      user: { type: 'string', maxLength: 255 },
      // Left out: the saved one stays.
      password: { type: 'string', maxLength: 500 },
      fromEmail: { anyOf: [{ type: 'string', format: 'email', maxLength: 255 }, { type: 'string', maxLength: 0 }] },
      fromName: { type: 'string', maxLength: 100 },
      dailyLimit: { type: 'integer', minimum: 0, maximum: 1_000_000 },
    },
  } as const;

  /** The settings sent, with the saved password when none was typed. */
  const withPassword = (body: Omit<SmtpSettings, 'password' | 'dailyLimit'> & { password?: string; dailyLimit?: number }): SmtpSettings => ({
    host: body.host.trim(),
    port: body.port,
    security: body.security,
    user: body.user.trim(),
    password: body.password ?? mailSettings().password,
    fromEmail: body.fromEmail.trim(),
    fromName: body.fromName.trim(),
    dailyLimit: body.dailyLimit ?? mailSettings().dailyLimit,
  });

  app.put<{ Body: Omit<SmtpSettings, 'password' | 'dailyLimit'> & { password?: string; dailyLimit?: number } }>('/admin/settings/email', { schema: { body: smtpSchema } }, async (req, reply) => {
    const next = withPassword(req.body);
    if (next.host && !next.fromEmail) return reply.code(400).send({ error: 'smtp_from_required' });
    const before = mailSettings();
    await saveMailSettings(db, next);
    // What changed (never the password itself: only that it did).
    const changed = (Object.keys(next) as (keyof SmtpSettings)[]).filter((key) => next[key] !== before[key]);
    if (changed.length) {
      void logAdmin(db, req.user!, 'settings.email', { type: 'settings', id: null, label: 'Email (SMTP)' }, {
        changed,
        ...Object.fromEntries(changed.filter((key) => key !== 'password').map((key) => [key, next[key]])),
      });
    }
    return { settings: publicMailSettings(), configured: mailConfigured(), production: config.production };
  });

  // A test email to `to`, with the settings in the form (saved or not): the SMTP server's own error if it fails.
  app.post<{ Body: { to: string; settings: Omit<SmtpSettings, 'password' | 'dailyLimit'> & { password?: string; dailyLimit?: number } } }>(
    '/admin/settings/email/test',
    {
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['to', 'settings'],
          additionalProperties: false,
          properties: { to: { type: 'string', format: 'email', maxLength: 255 }, settings: smtpSchema },
        },
      },
    },
    async (req, reply) => {
      const s = withPassword(req.body.settings);
      if (!s.host || !s.fromEmail) return reply.code(400).send({ error: 'smtp_from_required' });
      try {
        await sendTestMail(s, testEmail(req.body.to));
        return { ok: true };
      } catch (err) {
        return reply.code(502).send({ error: 'smtp_failed', message: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ---- The emails the site tried to send, newest first (the SMTP server's daily limit shows how close today is)

  app.get<{ Querystring: { status?: 'sent' | 'failed' | 'logged'; kind?: string; q?: string; offset: number; limit: number } }>(
    '/admin/email-log',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['sent', 'failed', 'logged'] },
            kind: { type: 'string', maxLength: 30 },
            q: { type: 'string', maxLength: 100 },
            ...paging,
          },
        },
      },
    },
    async (req) => {
      const { status, kind, q, offset, limit } = req.query;
      const where: string[] = [];
      const params: unknown[] = [];
      if (status) {
        where.push('status = ?');
        params.push(status);
      }
      if (kind) {
        where.push('kind = ?');
        params.push(kind);
      }
      for (const word of searchWords(q)) {
        where.push('(to_email LIKE ? OR subject LIKE ?)');
        params.push(word, word);
      }
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT id, created_at, to_email, kind, subject, status, error FROM email_log
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [...params, limit + 1, offset],
      );
      const today = siteDayStart(siteDay());
      const [[usage]] = await db.query<RowDataPacket[]>(
        `SELECT SUM(created_at >= ? AND status = 'sent') AS sent_today, SUM(created_at >= ? AND status = 'failed') AS failed_today,
                SUM(created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY AND status = 'failed') AS failed_24h,
                SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed, SUM(status = 'logged') AS logged, COUNT(*) AS total
           FROM email_log`,
        [today, today],
      );
      return {
        emails: rows.slice(0, limit).map((row) => ({
          id: row.id as number,
          createdAt: row.created_at as Date,
          to: row.to_email as string,
          kind: row.kind as string,
          subject: row.subject as string,
          status: row.status as string,
          error: row.error as string | null,
        })),
        hasMore: rows.length > limit,
        usage: {
          sentToday: num(usage!.sent_today),
          failedToday: num(usage!.failed_today),
          failed24h: num(usage!.failed_24h),
          dailyLimit: mailSettings().dailyLimit,
        },
        counts: { all: num(usage!.total), sent: num(usage!.sent), failed: num(usage!.failed), logged: num(usage!.logged) },
      };
    },
  );

  // ---- What administrators did, newest first: by administrator, kind of action, target, or words in the target's name

  app.get<{
    Querystring: { admin?: number; group?: string; targetType?: string; targetId?: number; q?: string; offset: number; limit: number };
  }>(
    '/admin/log',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            admin: { type: 'integer', minimum: 1 },
            group: { type: 'string', enum: ['user', 'comment', 'post', 'category', 'settings'] },
            targetType: { type: 'string', enum: ['user', 'comment', 'post', 'category', 'settings'] },
            targetId: { type: 'integer', minimum: 1 },
            q: { type: 'string', maxLength: 100 },
            ...paging,
          },
        },
      },
    },
    async (req) => {
      const { admin, group, targetType, targetId, q, offset, limit } = req.query;
      const where: string[] = [];
      const params: unknown[] = [];
      if (admin) {
        where.push('l.admin_id = ?');
        params.push(admin);
      }
      if (group) {
        where.push('l.target_type = ?');
        params.push(group);
      }
      if (targetType && targetId) {
        where.push('l.target_type = ? AND l.target_id = ?');
        params.push(targetType, targetId);
      }
      for (const word of searchWords(q)) {
        where.push('(l.target_label LIKE ? OR l.admin_name LIKE ?)');
        params.push(word, word);
      }
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT l.id, l.created_at, l.admin_id, l.admin_name, COALESCE(u.avatar_url, u.picture) AS admin_picture, l.action,
                l.target_type, l.target_id, l.target_label, l.details
           FROM admin_log l LEFT JOIN users u ON u.id = l.admin_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`,
        [...params, limit + 1, offset],
      );
      return {
        entries: rows.slice(0, limit).map((row) => ({
          id: row.id as number,
          createdAt: row.created_at as Date,
          admin: { id: row.admin_id as number | null, name: row.admin_name as string, picture: row.admin_picture as string | null },
          action: row.action as string,
          target: { type: row.target_type as string, id: row.target_id as number | null, label: row.target_label as string },
          details: (typeof row.details === 'string' ? JSON.parse(row.details) : row.details) as Record<string, unknown> | null,
        })),
        hasMore: rows.length > limit,
      };
    },
  );
};

export default adminRoutes;
