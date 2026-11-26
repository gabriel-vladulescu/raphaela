import type { FastifyPluginAsync } from 'fastify';
import { countAuthors } from '@/lib/follows';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { createEmailToken, finalizeAccountDeletion, liftSuspension, restoreAccount, RETENTION_MONTHS, revokeEmailTokens, suspendAccount, SUSPENDED_NOW } from '@/lib/accounts';
import { recordAccountChange } from '@/lib/accountChanges';
import { commentLabel, logAdmin } from '@/lib/adminLog';
import type { AdminTarget } from '@/lib/adminLog';
import { siteDay, siteDayStart } from '@/lib/analytics';
import { langOf, resetEmail, siteLink, testEmail } from '@/lib/emails';
import { parseId, requireOwner } from '@/lib/guards';
import { mailConfigured, mailSettings, saveMailSettings, sendMail, sendTestMail } from '@/lib/mail';
import type { SmtpSettings } from '@/lib/mail';
import { postLabel } from '@/lib/postEditing';
import { kindCondition, postPath, searchWords } from '@/lib/posts';
import type { Kind } from '@/lib/posts';
import { clearRetention, RETENTION_KEYS, retentionDue, retentionTotal } from '@/lib/retention';
import type { RetentionKey } from '@/lib/retention';
import { siteSettings } from '@/lib/siteSettings';
import { publicBook } from '@/lib/books';
import { periodProperties, periodWhere } from '@/lib/period';
import type { Period } from '@/lib/period';
import { endSessions } from '@/lib/sessionEnd';
import { AVATAR_PREFIX, removeUpload } from '@/lib/uploads';
import { usernameProblemFor } from '@/lib/usernames';

const DAY_MS = 24 * 60 * 60 * 1000;
const num = (value: unknown) => Number(value ?? 0);

const paging = {
  offset: { type: 'integer', minimum: 0, default: 0 },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
} as const;

/** What the administrators' log is filtered by: the kind of thing an action was on. */
const LOG_GROUPS = ['user', 'comment', 'post', 'book', 'category', 'support', 'settings'];

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
              (SELECT COUNT(*) FROM support_tickets WHERE status = 'open') AS tickets_open,
              (SELECT COUNT(*) FROM error_log WHERE seen_at IS NULL) AS errors_new,
              (SELECT COUNT(*) FROM error_log WHERE last_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY) AS errors_24h,
              (SELECT COUNT(*) FROM auth_log WHERE outcome <> 'ok' AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY) AS sign_in_failed_24h,
              (SELECT COUNT(*) FROM push_log WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY) AS pushes_24h,
              (SELECT COUNT(*) FROM books WHERE deleted_at IS NULL) AS books,
              (SELECT COUNT(*) FROM books bk WHERE ${publicBook()}) AS books_public,
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
    const cleanup = await retentionTotal(db);
    return {
      /** Rows past the time the Terms promise to keep them, waiting for an administrator (lib/retention.ts). */
      cleanup,
      tickets: { total: num(row!.tickets), unseen: num(row!.tickets_new), open: num(row!.tickets_open) },
      /** The server's errors: not looked at yet, and in the last 24 hours. */
      errors: { unseen: num(row!.errors_new), day: num(row!.errors_24h) },
      signIns: { failedDay: num(row!.sign_in_failed_24h) },
      pushes: { day: num(row!.pushes_24h) },
      books: { total: num(row!.books), public: num(row!.books_public) },
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
        sentToday: num(row!.mail_sent_today),
        failed24h: num(row!.mail_failed_24h),
        dailyLimit: mailSettings().dailyLimit,
      },
    };
  });

  // ---- Old data: what's past the time the Terms promise to keep it. Never deleted by itself: listed here, and an
  // administrator deletes it (one kind, or several at once).

  app.get('/admin/cleanup', async () => ({ items: await retentionDue(db) }));

  app.post<{ Body: { keys: RetentionKey[] } }>(
    '/admin/cleanup',
    {
      schema: {
        body: {
          type: 'object',
          required: ['keys'],
          properties: { keys: { type: 'array', minItems: 1, maxItems: RETENTION_KEYS.length, uniqueItems: true, items: { type: 'string', enum: RETENTION_KEYS } } },
        },
      },
    },
    async (req) => {
      const deleted: Partial<Record<RetentionKey, number>> = {};
      for (const key of req.body.keys) deleted[key] = await clearRetention(db, key);
      const items = await retentionDue(db);
      // Nothing left: the reminders about it are done with.
      if (items.every((item) => item.count === 0)) {
        await db.execute("UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE type = 'cleanup_due' AND read_at IS NULL");
      }
      void logAdmin(db, req.user!, 'settings.cleanup', { type: 'settings', id: null, label: 'Date vechi' }, { deleted });
      return { deleted, items };
    },
  );

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
        // An address, name or username it had before counts too (account_changes).
        base.push('(u.name LIKE ? OR u.email LIKE ? OR u.username LIKE ? OR EXISTS (SELECT 1 FROM account_changes c WHERE c.user_id = u.id AND c.old_value LIKE ?))');
        params.push(word, word, word, word);
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
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > UTC_TIMESTAMP() AND s.ended_at IS NULL) AS sessions,
              (SELECT COUNT(*) FROM comments m WHERE m.deleted_with_account = u.id) AS comments_with_account,
              (SELECT COUNT(*) FROM posts p WHERE p.deleted_with_account = u.id) AS posts_with_account,
              (SELECT COUNT(*) FROM author_follows f WHERE f.author_id = u.id) AS followers,
              (SELECT COUNT(*) FROM author_follows f WHERE f.user_id = u.id) AS following,
              (SELECT COUNT(*) FROM auth_log a WHERE a.user_id = u.id AND a.outcome <> 'ok' AND a.created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY) AS failed_day
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
    const [logins] = await db.query<RowDataPacket[]>(
      'SELECT created_at, device, expires_at, ended_at, end_reason FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
      [id],
    );
    const [attempts] = await db.query<RowDataPacket[]>(
      'SELECT created_at, email, method, outcome, device FROM auth_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 12',
      [id],
    );
    const [devices] = await db.query<RowDataPacket[]>(
      `SELECT ps.id, ps.device, ps.created_at, ps.last_sent_at, ps.activity, (SELECT COUNT(*) FROM push_books pb WHERE pb.subscription_id = ps.id) AS books
         FROM push_subscriptions ps WHERE ps.user_id = ? ORDER BY ps.created_at DESC`,
      [id],
    );
    const [changes] = await db.query<RowDataPacket[]>(
      'SELECT field, old_value, new_value, via, changed_at FROM account_changes WHERE user_id = ? ORDER BY changed_at DESC, id DESC LIMIT 20',
      [id],
    );
    const [links] = await db.query<RowDataPacket[]>(
      `SELECT purpose, email, created_at, expires_at, used_at, revoked_at, revoked_reason
         FROM email_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
      [id],
    );
    const base = toAdminUser(row);
    return {
      /** Its sign-ins (newest first): when, and whether they're still on, ran out, or ended (and why). */
      logins: logins.map((s) => ({
        startedAt: s.created_at as Date,
        device: s.device as string | null,
        expiresAt: s.expires_at as Date,
        endedAt: s.ended_at as Date | null,
        endReason: s.end_reason as string | null,
      })),
      /** Its sign-in attempts (newest first): how, how it went, from which browser. */
      attempts: attempts.map((a) => ({
        at: a.created_at as Date,
        email: a.email as string | null,
        method: a.method as string,
        outcome: a.outcome as string,
        device: a.device as string | null,
      })),
      /** Its devices with push: which browser, since when, the last push, whether its notifications go there, books followed. */
      devices: devices.map((d) => ({
        id: d.id as number,
        device: d.device as string | null,
        since: d.created_at as Date,
        lastSentAt: d.last_sent_at as Date | null,
        activity: Boolean(d.activity),
        books: num(d.books),
      })),
      /** Its earlier addresses, names and usernames (newest first). */
      changes: changes.map((c) => ({
        field: c.field as string,
        from: c.old_value as string | null,
        to: c.new_value as string | null,
        via: c.via as string,
        at: c.changed_at as Date,
      })),
      /** The links sent to the account by email (newest first), and what became of each. */
      links: links.map((l) => ({
        purpose: l.purpose as string,
        email: l.email as string,
        sentAt: l.created_at as Date,
        expiresAt: l.expires_at as Date,
        usedAt: l.used_at as Date | null,
        revokedAt: l.revoked_at as Date | null,
        revokedReason: l.revoked_reason as string | null,
      })),
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
        followers: num(row.followers),
        following: num(row.following),
        /** Failed sign-in attempts in the last 24 hours. */
        failedSignIns: num(row.failed_day),
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
      void countAuthors(db);
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
    await revokeEmailTokens(db, parseId(req.params.id) ?? 0, ['verify'], 'verified');
    void logAdmin(db, req.user!, 'user.verify_email', await userTarget(parseId(req.params.id)));
    return { ok: true };
  });

  // Corrects what a person shows the others (a name, username, occupation or quote that isn't right for the site,
  // a picture): each field given is set (empty clears occupation and quote), `removePicture` takes the picture off
  // (theirs and Google's). Name and username changes are kept in the account's history, as made by an administrator.
  app.patch<{ Params: { id: string }; Body: { name?: string; username?: string; occupation?: string; quote?: string; removePicture?: boolean } }>(
    '/admin/users/:id/profile',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', maxLength: 80 },
            username: { type: 'string', maxLength: 40 },
            occupation: { type: 'string', maxLength: 80 },
            quote: { type: 'string', maxLength: 300 },
            removePicture: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const id = parseId(req.params.id);
      const problem = await changeable(id, req.user!.id);
      if (problem) return reply.code(problem.status).send({ error: problem.error });
      const [[row]] = await db.execute<RowDataPacket[]>('SELECT name, username, occupation, quote, avatar_url, picture FROM users WHERE id = ?', [id]);
      const changed: string[] = [];
      const name = req.body.name?.trim();
      const newName = name !== undefined && name !== row!.name;
      if (newName && name.length < 2) return reply.code(400).send({ error: 'name_invalid' });
      const username = req.body.username?.trim().toLowerCase();
      if (username !== undefined && username !== row!.username) {
        const taken = await usernameProblemFor(db, username, id!);
        if (taken) return reply.code(taken === 'username_taken' ? 409 : 400).send({ error: taken });
        try {
          await db.execute('UPDATE users SET username = ? WHERE id = ?', [username, id]);
        } catch (err) {
          if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return reply.code(409).send({ error: 'username_taken' });
          throw err;
        }
        await recordAccountChange(db, id!, 'username', row!.username as string | null, username, 'admin');
        changed.push('username');
      }
      if (newName) {
        await db.execute('UPDATE users SET name = ? WHERE id = ?', [name, id]);
        await recordAccountChange(db, id!, 'name', row!.name as string, name, 'admin');
        changed.push('name');
      }
      for (const field of ['occupation', 'quote'] as const) {
        const value = req.body[field];
        if (value === undefined || (value.trim() || null) === row![field]) continue;
        await db.execute(`UPDATE users SET ${field} = ? WHERE id = ?`, [value.trim() || null, id]);
        changed.push(field);
      }
      if (req.body.removePicture && (row!.avatar_url || row!.picture)) {
        await db.execute('UPDATE users SET avatar_url = NULL, picture = NULL WHERE id = ?', [id]);
        await removeUpload((row!.avatar_url as string | null) ?? null, AVATAR_PREFIX);
        changed.push('picture');
      }
      if (changed.length) void logAdmin(db, req.user!, 'user.profile', await userTarget(id), { changed });
      return { ok: true, changed };
    },
  );

  // Signs the account out everywhere (a sign-in that shouldn't be there, a shared device). Its sign-ins are kept,
  // ended "by an administrator".
  app.post<{ Params: { id: string } }>('/admin/users/:id/sessions/end', async (req, reply) => {
    const id = parseId(req.params.id);
    const problem = await changeable(id, req.user!.id);
    if (problem) return reply.code(problem.status).send({ error: problem.error });
    const [[open]] = await db.execute<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND ended_at IS NULL AND expires_at > UTC_TIMESTAMP()',
      [id],
    );
    await endSessions(db, id!, 'admin');
    void logAdmin(db, req.user!, 'user.sessions_end', await userTarget(id), { sessions: num(open!.n) });
    return { ended: num(open!.n) };
  });

  // Sends the person a link to choose a new password (someone who can't sign in and wrote to support). Only with a
  // way to send email.
  app.post<{ Params: { id: string }; Body: { lang?: string } }>(
    '/admin/users/:id/password-reset',
    { schema: { body: { type: 'object', additionalProperties: false, properties: { lang: { type: 'string', enum: ['ro', 'en'] } } } } },
    async (req, reply) => {
      const id = parseId(req.params.id);
      const problem = await changeable(id, req.user!.id);
      if (problem) return reply.code(problem.status).send({ error: problem.error });
      if (!mailConfigured()) return reply.code(503).send({ error: 'email_unavailable' });
      const [[row]] = await db.execute<RowDataPacket[]>('SELECT name, email FROM users WHERE id = ?', [id]);
      const token = await createEmailToken(db, id!, 'reset', row!.email as string);
      const sent = await sendMail(resetEmail(row!.email as string, langOf(req.body?.lang), row!.name as string, siteLink(`/resetare-parola?token=${token}`)));
      void logAdmin(db, req.user!, 'user.password_reset', await userTarget(id));
      if (!sent) return reply.code(502).send({ error: 'email_failed' });
      return { ok: true, email: row!.email as string };
    },
  );

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

  // ---- Posts, or the books' chapters (`kind`): every one, with its numbers (writing and editing happen in the
  // site's editor)

  app.get<{ Querystring: { kind: Kind; status: PostStatusFilter; q?: string; author?: number; book?: number; sort: keyof typeof POST_SORT; offset: number; limit: number } }>(
    '/admin/posts',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['post', 'chapter'], default: 'post' },
            status: { type: 'string', enum: Object.keys(POST_STATUS), default: 'all' },
            q: { type: 'string', maxLength: 100 },
            author: { type: 'integer', minimum: 1 },
            book: { type: 'integer', minimum: 1 },
            sort: { type: 'string', enum: Object.keys(POST_SORT), default: 'new' },
            ...paging,
          },
        },
      },
    },
    async (req) => {
      const { kind, status, q, author, book, sort, offset, limit } = req.query;
      const base: string[] = [kindCondition(kind)];
      const params: unknown[] = [];
      if (book) {
        base.push('p.book_id = ?');
        params.push(book);
      }
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
                p.chapter_no, bk.id AS book_id, bk.title AS book_title, bk.slug AS book_slug,
                u.id AS author_id, u.name AS author_name, u.username AS author_username,
                COALESCE(u.avatar_url, u.picture) AS author_picture, u.deleted_at IS NOT NULL AS author_deleted,
                (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id AND l.removed_at IS NULL) AS likes,
                (SELECT COUNT(*) FROM comments m WHERE m.post_id = p.id AND m.deleted_at IS NULL) AS comments
           FROM posts p
           JOIN users u ON u.id = p.author_id
           LEFT JOIN categories c ON c.id = p.category_id
           LEFT JOIN books bk ON bk.id = p.book_id
          WHERE ${where}
          ORDER BY ${POST_SORT[sort]}
          LIMIT ? OFFSET ?`,
        [...params, limit + 1, offset],
      );
      const [[counts]] = await db.query<RowDataPacket[]>(
        `SELECT ${Object.entries(POST_STATUS)
          .map(([key, sql]) => `SUM(${sql}) AS \`${key}\``)
          .join(', ')}
           FROM posts p WHERE ${base.join(' AND ')}`,
        params,
      );
      const now = Date.now();
      return {
        posts: rows.slice(0, limit).map((row) => {
          const publishedAt = row.published_at as Date | null;
          return {
            id: row.id as number,
            slug: row.slug as string,
            /** Where it's read (a chapter: under its book). */
            path: postPath(row.slug as string, (row.book_slug as string | null) ?? null),
            title: row.title as string,
            /** A chapter: its book and its number there. */
            book: row.book_id ? { id: row.book_id as number, title: row.book_title as string, slug: row.book_slug as string, chapter: num(row.chapter_no) } : null,
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
    return { type: 'post', id, label: rows[0] ? postLabel(rows[0].title as string) : `#${id}` };
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
    return { settings: publicMailSettings(), configured: mailConfigured() };
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

  app.get<{ Querystring: Period & { status?: 'sent' | 'failed'; kind?: string; q?: string; offset: number; limit: number } }>(
    '/admin/email-log',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['sent', 'failed'] },
            kind: { type: 'string', maxLength: 30 },
            q: { type: 'string', maxLength: 100 },
            ...periodProperties,
            ...paging,
          },
        },
      },
    },
    async (req) => {
      const { status, kind, q, offset, limit } = req.query;
      const { where, params } = periodWhere('created_at', req.query);
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
                SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed, COUNT(*) AS total
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
        counts: { all: num(usage!.total), sent: num(usage!.sent), failed: num(usage!.failed) },
      };
    },
  );

  // ---- What administrators did, newest first: by administrator, kind of action, target, or words in the target's name

  app.get<{
    Querystring: Period & { admin?: number; group?: string; targetType?: string; targetId?: number; q?: string; offset: number; limit: number };
  }>(
    '/admin/log',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            admin: { type: 'integer', minimum: 1 },
            group: { type: 'string', enum: LOG_GROUPS },
            targetType: { type: 'string', enum: LOG_GROUPS },
            ...periodProperties,
            targetId: { type: 'integer', minimum: 1 },
            q: { type: 'string', maxLength: 100 },
            ...paging,
          },
        },
      },
    },
    async (req) => {
      const { admin, group, targetType, targetId, q, offset, limit } = req.query;
      const { where, params } = periodWhere('l.created_at', req.query);
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
