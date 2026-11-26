import type { FastifyPluginAsync } from 'fastify';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { insertComment, MAX_DEPTH } from '@/lib/comments';
import type { ParentComment } from '@/lib/comments';
import { commentLabel, logAdmin } from '@/lib/adminLog';
import { parseId, requireUser } from '@/lib/guards';
import { notifyComment, notifyHeld, notifyReaction, notifyReport } from '@/lib/notifications';
import type { SessionUser } from '@/lib/session';
import { escapeLike, visibleTo } from '@/lib/posts';
import { checkComment, siteSettings } from '@/lib/siteSettings';

/** Why a comment can be reported. */
export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'inappropriate', 'other'] as const;

/** The reactions people can leave on a comment. */
export const COMMENT_EMOJI = ['❤️', '✨', '🌙', '🔥', '😂', '🙏'];

// A deleted account's comments stay (the replies around them still make sense), without its name or picture.
const COMMENT_SELECT = `
  SELECT m.id, m.parent_id, m.body, m.created_at, m.edited_at, m.deleted_at, m.held_at, d.name AS deleted_by_name,
         u.id AS author_id, u.deleted_at IS NOT NULL AS author_deleted,
         IF(u.deleted_at IS NULL, u.name, '') AS author_name, IF(u.deleted_at IS NULL, COALESCE(u.avatar_url, u.picture), NULL) AS author_picture
    FROM comments m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN users d ON d.id = m.deleted_by`;

const bodySchema = {
  type: 'object',
  required: ['body'],
  additionalProperties: false,
  properties: { body: { type: 'string', maxLength: 2000 } },
} as const;

interface Reactions {
  reactions: Record<string, number>;
  mine: string[];
}

/** Replies a page of threads brings under each thread's first comment; the rest come when asked (REPLY_PAGE at a
 *  time, GET /comments/:id/replies), as do the replies to replies. A long discussion never arrives whole. */
const REPLY_PREVIEW = 3;

function toComment(row: RowDataPacket, reactions: Reactions = { reactions: {}, mine: [] }, replyCount = 0) {
  return {
    id: row.id as number,
    parentId: row.parent_id as number | null,
    /** Its replies (direct ones) the viewer can see; only some may have been sent. */
    replyCount,
    body: row.body as string,
    createdAt: row.created_at as Date,
    editedAt: row.edited_at as Date | null,
    // Deleted comments only reach owners, who see them greyed out.
    deletedAt: row.deleted_at as Date | null,
    deletedBy: row.deleted_at ? ((row.deleted_by_name as string | null) ?? null) : null,
    /** Waits for an administrator's approval: only its writer (and administrators) see it. */
    held: row.held_at != null,
    author: {
      id: row.author_id as number,
      name: row.author_name as string,
      picture: row.author_picture as string | null,
      /** The account was deleted: shown as "deleted account". */
      deleted: Boolean(row.author_deleted),
    },
    ...reactions,
  };
}

/** Reaction counts per comment (live ones; taken-back reactions stay as history), plus which ones the viewer added
 *  (in the order they were first used). */
async function loadReactions(db: Pool, where: string, params: unknown[], viewerId: number): Promise<Map<number, Reactions>> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT r.comment_id, r.emoji, COUNT(*) AS n, MAX(r.user_id = ?) AS mine
       FROM comment_reactions r JOIN comments m ON m.id = r.comment_id
      WHERE r.removed_at IS NULL AND ${where}
      GROUP BY r.comment_id, r.emoji
      ORDER BY r.comment_id, MIN(r.created_at)`,
    [viewerId, ...params],
  );
  const byComment = new Map<number, Reactions>();
  for (const row of rows) {
    const entry = byComment.get(row.comment_id) ?? { reactions: {}, mine: [] };
    entry.reactions[row.emoji] = Number(row.n);
    if (Number(row.mine)) entry.mine.push(row.emoji);
    byComment.set(row.comment_id, entry);
  }
  return byComment;
}

/** A post the viewer can see, with whether its comments are on. */
/** What a viewer sees of a discussion: owners everything (deleted comments greyed out); others the live comments, and
 *  those waiting for approval only when they wrote them. */
const liveFor = (user: SessionUser | null | undefined) => (alias: string) =>
  user?.role === 'owner' ? '' : `AND ${alias}.deleted_at IS NULL AND (${alias}.held_at IS NULL OR ${alias}.user_id = ${Number(user?.id ?? 0)})`;

/** How many replies each comment has (direct ones), as the viewer sees them. */
async function replyCounts(db: Pool, ids: number[], live: (alias: string) => string) {
  if (ids.length === 0) return new Map<number, number>();
  const [rows] = await db.query<RowDataPacket[]>(`SELECT r.parent_id, COUNT(*) AS n FROM comments r WHERE r.parent_id IN (?) ${live('r')} GROUP BY r.parent_id`, [ids]);
  return new Map(rows.map((row) => [row.parent_id as number, Number(row.n)]));
}

/** Comments as the client gets them: each with its reactions (the viewer's own marked) and its number of replies. */
async function toComments(db: Pool, rows: RowDataPacket[], viewerId: number, live: (alias: string) => string) {
  const ids = rows.map((row) => row.id as number);
  if (ids.length === 0) return [];
  const [reactions, counts] = await Promise.all([loadReactions(db, 'm.id IN (?)', [ids], viewerId), replyCounts(db, ids, live)]);
  return rows.map((row) => toComment(row, reactions.get(row.id as number), counts.get(row.id as number) ?? 0));
}

async function findPost(db: Pool, user: SessionUser | null, postId: number) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT p.id, p.comments_enabled FROM posts p WHERE p.id = ? AND ${visibleTo(user)}`, [postId]);
  return rows[0] ? { id: rows[0].id as number, commentsEnabled: Boolean(rows[0].comments_enabled) } : null;
}

/** A comment that can still be acted on: not deleted, on a post the viewer can see that has comments on. */
type LiveComment = { ok: true; id: number; userId: number } | { ok: false; status: number; error: string };

/** A comment waiting for approval is there only for its writer and administrators (as if it didn't exist for others). */
const heldVisible = (user: SessionUser | null, alias = 'm') =>
  user?.role === 'owner' ? '' : `AND (${alias}.held_at IS NULL OR ${alias}.user_id = ${Number(user?.id ?? 0)})`;

async function findLiveComment(db: Pool, user: SessionUser | null, commentId: number): Promise<LiveComment> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT m.id, m.user_id, p.comments_enabled
       FROM comments m JOIN posts p ON p.id = m.post_id
      WHERE m.id = ? AND m.deleted_at IS NULL ${heldVisible(user)} AND ${visibleTo(user)}`,
    [commentId],
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 404, error: 'not_found' };
  if (!row.comments_enabled) return { ok: false, status: 403, error: 'comments_disabled' };
  return { ok: true, id: row.id as number, userId: row.user_id as number };
}

const commentRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;
  const postIdOf = async (commentId: number) => {
    const [[row]] = await db.execute<RowDataPacket[]>('SELECT post_id FROM comments WHERE id = ?', [commentId]);
    return (row?.post_id as number | undefined) ?? null;
  };

  // Who can be written as @username in a post's discussion: its author and the people who commented there (by
  // name or username, a few at a time). Signed in only.
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
    '/posts/:id/mentionable',
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 40 } } } },
    },
    async (req, reply) => {
      const post = await findPost(db, req.user, parseId(req.params.id) ?? 0);
      if (!post) return reply.code(404).send({ error: 'not_found' });
      const q = (req.query.q ?? '').trim().toLowerCase();
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT u.id, u.name, u.username, COALESCE(u.avatar_url, u.picture) AS picture
           FROM users u
          WHERE u.deleted_at IS NULL AND u.username IS NOT NULL AND u.id <> ?
            AND (u.id = (SELECT author_id FROM posts WHERE id = ?)
                 OR u.id IN (SELECT user_id FROM comments WHERE post_id = ? AND deleted_at IS NULL AND held_at IS NULL))
            ${q ? 'AND (u.username LIKE ? OR u.name LIKE ?)' : ''}
          ORDER BY u.name LIMIT 6`,
        [req.user!.id, post.id, post.id, ...(q ? [`${escapeLike(q)}%`, `%${escapeLike(q)}%`] : [])],
      );
      return {
        people: rows.map((row) => ({ username: row.username as string, name: row.name as string, picture: row.picture as string | null })),
      };
    },
  );

  // A page of threads, "top" (most reactions and replies) or "new" first: each thread's first comment with its first
  // replies (REPLY_PREVIEW, oldest first), each with how many replies it has; the rest come when asked
  // (/comments/:id/replies). While comments are off, nobody sees them (they come back if the author turns them on).
  app.get<{ Params: { id: string }; Querystring: { sort: 'top' | 'new'; offset: number; limit: number } }>(
    '/posts/:id/comments',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            sort: { type: 'string', enum: ['top', 'new'], default: 'top' },
            offset: { type: 'integer', minimum: 0, default: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          },
        },
      },
    },
    async (req, reply) => {
      const post = await findPost(db, req.user, parseId(req.params.id) ?? 0);
      if (!post) return reply.code(404).send({ error: 'not_found' });
      // Whether commenting needs a confirmed address (the admin panel's setting): the page says so to those without one.
      const requireVerifiedEmail = siteSettings().commentsRequireVerifiedEmail;
      if (!post.commentsEnabled) return { enabled: false, requireVerifiedEmail, total: 0, order: [], comments: [], hasMore: false };

      const { sort, offset, limit } = req.query;
      // Owners also get deleted comments (shown greyed out); they still don't count. (A delete takes the replies
      // with it, so a live comment's thread root is live too.)
      // Comments waiting for approval: only their writer's (and administrators') to see.
      const viewerId = Number(req.user?.id ?? 0);
      const live = liveFor(req.user);
      const [[count]] = await db.execute<RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND deleted_at IS NULL AND held_at IS NULL',
        [post.id],
      );

      // "top": a thread's live reactions plus its comments (the first one included).
      const [roots] =
        sort === 'new'
          ? await db.query<RowDataPacket[]>(
              `SELECT m.id FROM comments m WHERE m.post_id = ? AND m.parent_id IS NULL ${live('m')}
                ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`,
              [post.id, limit + 1, offset],
            )
          : await db.query<RowDataPacket[]>(
              `SELECT root.id
                 FROM comments root
                 JOIN comments m ON m.post_id = root.post_id AND m.root_id = root.id ${live('m')}
                WHERE root.post_id = ? AND root.parent_id IS NULL ${live('root')}
                GROUP BY root.id, root.created_at
                ORDER BY SUM((SELECT COUNT(*) FROM comment_reactions r WHERE r.comment_id = m.id AND r.removed_at IS NULL)) + COUNT(*) DESC,
                         root.created_at DESC, root.id DESC
                LIMIT ? OFFSET ?`,
              [post.id, limit + 1, offset],
            );
      const order = roots.slice(0, limit).map((row) => row.id as number);
      const page = { enabled: true, requireVerifiedEmail, total: Number(count.n), order, hasMore: roots.length > limit };
      if (order.length === 0) return { ...page, comments: [] };

      // The threads' first comments, and the first replies to each.
      const [rows] = await db.query<RowDataPacket[]>(
        `${COMMENT_SELECT}
          WHERE m.id IN (?)
             OR m.id IN (SELECT first.id FROM (
                  SELECT r.id, ROW_NUMBER() OVER (PARTITION BY r.parent_id ORDER BY r.created_at, r.id) AS n
                    FROM comments r WHERE r.parent_id IN (?) ${live('r')}
                ) first WHERE first.n <= ?)
          ORDER BY m.created_at, m.id`,
        [order, order, REPLY_PREVIEW],
      );
      return { ...page, comments: await toComments(db, rows, viewerId, live) };
    },
  );

  // A comment's replies (direct ones, oldest first), a page at a time: "view more replies" under it.
  app.get<{ Params: { id: string }; Querystring: { offset: number; limit: number } }>(
    '/comments/:id/replies',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            offset: { type: 'integer', minimum: 0, default: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          },
        },
      },
    },
    async (req, reply) => {
      const live = liveFor(req.user);
      // The comment, as this viewer may see it, on a post they can see with comments on.
      const [found] = await db.query<RowDataPacket[]>(
        `SELECT m.id, m.post_id FROM comments m WHERE m.id = ? ${live('m')}`,
        [parseId(req.params.id) ?? 0],
      );
      const parent = found[0];
      const post = parent ? await findPost(db, req.user, parent.post_id as number) : null;
      if (!parent || !post?.commentsEnabled) return reply.code(404).send({ error: 'not_found' });
      const { offset, limit } = req.query;
      const [rows] = await db.query<RowDataPacket[]>(
        `${COMMENT_SELECT} WHERE m.parent_id = ? ${live('m')} ORDER BY m.created_at, m.id LIMIT ? OFFSET ?`,
        [parent.id, limit + 1, offset],
      );
      const total = (await replyCounts(db, [parent.id as number], live)).get(parent.id as number) ?? 0;
      return { replies: await toComments(db, rows.slice(0, limit), Number(req.user?.id ?? 0), live), total, hasMore: rows.length > limit };
    },
  );

  app.post<{ Params: { id: string }; Body: { body: string; parentId?: number | null } }>(
    '/posts/:id/comments',
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['body'],
          additionalProperties: false,
          properties: {
            body: { type: 'string', maxLength: 2000 },
            parentId: { type: ['integer', 'null'], minimum: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const post = await findPost(db, req.user, parseId(req.params.id) ?? 0);
      if (!post) return reply.code(404).send({ error: 'not_found' });
      if (!post.commentsEnabled) return reply.code(403).send({ error: 'comments_disabled' });
      if (siteSettings().commentsRequireVerifiedEmail && !req.user!.emailVerified && req.user!.role !== 'owner') {
        return reply.code(403).send({ error: 'email_unverified' });
      }
      const body = req.body.body.trim();
      if (!body) return reply.code(400).send({ error: 'comment_empty' });

      // A reply to a comment on the last allowed level goes to that comment's parent instead (same level, same thread).
      let parent: ParentComment | null = null;
      if (req.body.parentId != null) {
        const findParent = async (id: number) => {
          const [rows] = await db.query<RowDataPacket[]>(
            `SELECT m.id, m.parent_id, m.root_id, m.depth FROM comments m WHERE m.id = ? AND m.post_id = ? AND m.deleted_at IS NULL ${heldVisible(req.user)}`,
            [id, post.id],
          );
          const row = rows[0];
          return row ? { id: row.id as number, parentId: row.parent_id as number | null, rootId: row.root_id as number, depth: row.depth as number } : null;
        };
        let answered = await findParent(req.body.parentId);
        if (answered && answered.depth >= MAX_DEPTH - 1 && answered.parentId !== null) answered = await findParent(answered.parentId);
        if (!answered) return reply.code(400).send({ error: 'comment_invalid_parent' });
        parent = answered;
      }

      // The comment filters (admin panel → Settings): administrators and authors aren't checked.
      const user = req.user!;
      let held: string | null = null;
      if (user.role === 'member') {
        const check = checkComment(body);
        if (check.verdict === 'block') return reply.code(400).send({ error: 'comment_blocked' });
        if (check.verdict === 'hold') held = check.reason;
        else if (siteSettings().firstCommentApproval) {
          const [approved] = await db.execute<RowDataPacket[]>('SELECT 1 FROM comments WHERE user_id = ? AND held_at IS NULL AND deleted_at IS NULL LIMIT 1', [user.id]);
          if (approved.length === 0) held = 'first';
        }
      }

      const id = await insertComment(db, { postId: post.id, userId: user.id, parent, body });
      if (held) {
        await db.execute('UPDATE comments SET held_at = UTC_TIMESTAMP(), held_reason = ? WHERE id = ?', [held, id]);
        // Nobody hears about it until it's approved, except the administrators, who decide.
        void notifyHeld(db, { commentId: id, postId: post.id, actorId: user.id, excerpt: body.slice(0, 140) });
      } else {
        void notifyComment(db, { postId: post.id, commentId: id, actorId: user.id, parentId: parent?.id ?? null, body });
      }
      const [[row]] = await db.execute<RowDataPacket[]>(`${COMMENT_SELECT} WHERE m.id = ?`, [id]);
      return { comment: toComment(row!) };
    },
  );

  // Only the person who wrote a comment can edit it (owners can remove comments, not rewrite them).
  app.patch<{ Params: { id: string }; Body: { body: string } }>(
    '/comments/:id',
    { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { body: bodySchema } },
    async (req, reply) => {
      const found = await findLiveComment(db, req.user, parseId(req.params.id) ?? 0);
      if (!found.ok) return reply.code(found.status).send({ error: found.error });
      if (found.userId !== req.user!.id) return reply.code(403).send({ error: 'forbidden' });
      const body = req.body.body.trim();
      if (!body) return reply.code(400).send({ error: 'comment_empty' });
      // An edit goes through the comment filters too (a blocked word added later is held, or refused).
      const check = req.user!.role === 'member' ? checkComment(body) : { verdict: 'ok' as const };
      if (check.verdict === 'block') return reply.code(400).send({ error: 'comment_blocked' });
      if (check.verdict === 'hold') {
        await db.execute('UPDATE comments SET held_at = COALESCE(held_at, UTC_TIMESTAMP()), held_reason = ? WHERE id = ?', [check.reason, found.id]);
        void notifyHeld(db, { commentId: found.id, postId: (await postIdOf(found.id)) ?? 0, actorId: req.user!.id, excerpt: body.slice(0, 140) });
      }
      // The text it replaces is kept (comment_revisions), e.g. for moderation.
      await db.execute(
        'INSERT INTO comment_revisions (comment_id, body, replaced_at) SELECT id, body, UTC_TIMESTAMP() FROM comments WHERE id = ? AND body <> ?',
        [found.id, body],
      );
      await db.execute('UPDATE comments SET body = ?, edited_at = UTC_TIMESTAMP() WHERE id = ? AND body <> ?', [body, found.id, body]);
      const [[row]] = await db.execute<RowDataPacket[]>('SELECT body, edited_at, held_at FROM comments WHERE id = ?', [found.id]);
      return { body: row.body as string, editedAt: row.edited_at as Date, held: row.held_at != null };
    },
  );

  // Adds the viewer's reaction, or takes it back if they already left that one (the row stays, marked removed).
  app.post<{ Params: { id: string }; Body: { emoji: string } }>(
    '/comments/:id/reactions',
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['emoji'],
          additionalProperties: false,
          properties: { emoji: { type: 'string', maxLength: 16 } },
        },
      },
    },
    async (req, reply) => {
      const { emoji } = req.body;
      if (!COMMENT_EMOJI.includes(emoji)) return reply.code(400).send({ error: 'reaction_invalid' });
      const found = await findLiveComment(db, req.user, parseId(req.params.id) ?? 0);
      if (!found.ok) return reply.code(found.status).send({ error: found.error });

      const commentId = found.id;
      const userId = req.user!.id;
      const [standing] = await db.execute<RowDataPacket[]>(
        'SELECT id FROM comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ? AND removed_at IS NULL',
        [commentId, userId, emoji],
      );
      if (standing[0]) {
        await db.execute('UPDATE comment_reactions SET removed_at = UTC_TIMESTAMP() WHERE id = ?', [standing[0].id]);
      } else {
        // IGNORE: a second tap racing the first lands on the one-live-reaction index.
        const [added] = await db.execute<ResultSetHeader>('INSERT IGNORE INTO comment_reactions (comment_id, user_id, emoji) VALUES (?, ?, ?)', [
          commentId,
          userId,
          emoji,
        ]);
        if (added.affectedRows > 0) void notifyReaction(db, { commentId, actorId: userId, emoji });
      }
      const reactions = await loadReactions(db, 'm.id = ?', [commentId], userId);
      return reactions.get(commentId) ?? { reactions: {}, mine: [] };
    },
  );

  // Reports a comment to the administrators (the admin panel's moderation queue). Not one's own; once per person
  // while the report is open (again: the same answer, nothing new). Administrators delete instead.
  app.post<{ Params: { id: string }; Body: { reason: (typeof REPORT_REASONS)[number]; details?: string } }>(
    '/comments/:id/report',
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['reason'],
          additionalProperties: false,
          properties: { reason: { type: 'string', enum: [...REPORT_REASONS] }, details: { type: 'string', maxLength: 500 } },
        },
      },
    },
    async (req, reply) => {
      const user = req.user!;
      if (user.role === 'owner') return reply.code(403).send({ error: 'forbidden' });
      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT m.id, m.user_id, m.post_id, m.body FROM comments m JOIN posts p ON p.id = m.post_id
          WHERE m.id = ? AND m.deleted_at IS NULL ${heldVisible(user)} AND ${visibleTo(user)}`,
        [parseId(req.params.id) ?? 0],
      );
      const comment = rows[0];
      if (!comment) return reply.code(404).send({ error: 'not_found' });
      if (comment.user_id === user.id) return reply.code(400).send({ error: 'report_own' });
      const [added] = await db.execute<ResultSetHeader>(
        `INSERT IGNORE INTO comment_reports (comment_id, reporter_id, reason, details, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())`,
        [comment.id, user.id, req.body.reason, req.body.details?.trim() || null],
      );
      // Administrators hear about it (not again for a report already open).
      if (added.affectedRows > 0) {
        void notifyReport(db, {
          commentId: comment.id as number,
          postId: comment.post_id as number,
          reporterId: user.id,
          reason: req.body.reason,
          excerpt: String(comment.body).slice(0, 140),
        });
      }
      return { ok: true };
    },
  );

  // A soft delete, by the person who wrote it or an owner (not by anyone else, whatever their role).
  // Its replies go with it. Owners still see all of them, marked as deleted.
  app.delete<{ Params: { id: string } }>('/comments/:id', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT m.id, m.user_id, m.body FROM comments m JOIN posts p ON p.id = m.post_id
        WHERE m.id = ? AND m.deleted_at IS NULL AND ${visibleTo(user)}`,
      [parseId(req.params.id) ?? 0],
    );
    const comment = rows[0];
    if (!comment) return reply.code(404).send({ error: 'not_found' });
    if (comment.user_id !== user.id && user.role !== 'owner') return reply.code(403).send({ error: 'forbidden' });

    const [thread] = await db.execute<RowDataPacket[]>(
      `WITH RECURSIVE thread AS (
         SELECT id FROM comments WHERE id = ?
         UNION ALL
         SELECT c.id FROM comments c JOIN thread t ON c.parent_id = t.id
       )
       SELECT id FROM thread`,
      [comment.id],
    );
    const ids = thread.map((row) => row.id as number);
    await db.query('UPDATE comments SET deleted_at = UTC_TIMESTAMP(), deleted_by = ? WHERE id IN (?) AND deleted_at IS NULL', [user.id, ids]);
    // Reports about them are settled: the comments are gone.
    await db.query(
      `UPDATE comment_reports SET resolved_at = UTC_TIMESTAMP(), resolved_by = ?, resolution = 'removed'
        WHERE comment_id IN (?) AND resolved_at IS NULL`,
      [user.id, ids],
    );
    // An administrator removing someone else's comment: in the log, with who wrote it.
    if (user.role === 'owner' && comment.user_id !== user.id) {
      const [[writer]] = await db.execute<RowDataPacket[]>('SELECT name FROM users WHERE id = ?', [comment.user_id]);
      void logAdmin(db, user, 'comment.delete', { type: 'comment', id: comment.id as number, label: commentLabel(String(comment.body)) }, {
        author: (writer?.name as string | undefined) ?? null,
        replies: ids.length - 1,
      });
    }
    return { ids };
  });
};

export default commentRoutes;
