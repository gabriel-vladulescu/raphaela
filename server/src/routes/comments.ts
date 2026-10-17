import type { FastifyPluginAsync } from 'fastify';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { insertComment, MAX_DEPTH } from '@/lib/comments';
import type { ParentComment } from '@/lib/comments';
import { parseId, requireUser } from '@/lib/guards';
import { notifyComment, notifyReaction } from '@/lib/notifications';
import type { SessionUser } from '@/lib/session';
import { visibleTo } from '@/lib/posts';

/** The reactions people can leave on a comment. */
export const COMMENT_EMOJI = ['❤️', '✨', '🌙', '🔥', '😂', '🙏'];

const COMMENT_SELECT = `
  SELECT m.id, m.parent_id, m.body, m.created_at, m.edited_at, m.deleted_at, d.name AS deleted_by_name,
         u.id AS author_id, u.name AS author_name, COALESCE(u.avatar_url, u.picture) AS author_picture
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

function toComment(row: RowDataPacket, reactions: Reactions = { reactions: {}, mine: [] }) {
  return {
    id: row.id as number,
    parentId: row.parent_id as number | null,
    body: row.body as string,
    createdAt: row.created_at as Date,
    editedAt: row.edited_at as Date | null,
    // Deleted comments only reach owners, who see them greyed out.
    deletedAt: row.deleted_at as Date | null,
    deletedBy: row.deleted_at ? ((row.deleted_by_name as string | null) ?? null) : null,
    author: { id: row.author_id as number, name: row.author_name as string, picture: row.author_picture as string | null },
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
async function findPost(db: Pool, user: SessionUser | null, postId: number) {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT p.id, p.comments_enabled FROM posts p WHERE p.id = ? AND ${visibleTo(user)}`, [postId]);
  return rows[0] ? { id: rows[0].id as number, commentsEnabled: Boolean(rows[0].comments_enabled) } : null;
}

/** A comment that can still be acted on: not deleted, on a post the viewer can see that has comments on. */
type LiveComment = { ok: true; id: number; userId: number } | { ok: false; status: number; error: string };

async function findLiveComment(db: Pool, user: SessionUser | null, commentId: number): Promise<LiveComment> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT m.id, m.user_id, p.comments_enabled
       FROM comments m JOIN posts p ON p.id = m.post_id
      WHERE m.id = ? AND m.deleted_at IS NULL AND ${visibleTo(user)}`,
    [commentId],
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 404, error: 'not_found' };
  if (!row.comments_enabled) return { ok: false, status: 403, error: 'comments_disabled' };
  return { ok: true, id: row.id as number, userId: row.user_id as number };
}

const commentRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  // A page of threads (a top-level comment with all its replies), "top" (most reactions and replies) or "new"
  // first. While comments are off, nobody sees them (they come back if the author turns comments on again).
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
      if (!post.commentsEnabled) return { enabled: false, total: 0, order: [], comments: [], hasMore: false };

      const { sort, offset, limit } = req.query;
      // Owners also get deleted comments (shown greyed out); they still don't count. (A delete takes the replies
      // with it, so a live comment's thread root is live too.)
      const live = (alias: string) => (req.user?.role === 'owner' ? '' : `AND ${alias}.deleted_at IS NULL`);
      const [[count]] = await db.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND deleted_at IS NULL', [post.id]);

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
      const page = { enabled: true, total: Number(count.n), order, hasMore: roots.length > limit };
      if (order.length === 0) return { ...page, comments: [] };

      const [rows] = await db.query<RowDataPacket[]>(
        `${COMMENT_SELECT} WHERE m.post_id = ? AND m.root_id IN (?) ${live('m')} ORDER BY m.created_at, m.id`,
        [post.id, order],
      );
      const ids = rows.map((row) => row.id as number);
      const reactions = await loadReactions(db, 'm.id IN (?)', [ids], req.user?.id ?? 0);
      return { ...page, comments: rows.map((row) => toComment(row, reactions.get(row.id))) };
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
      const body = req.body.body.trim();
      if (!body) return reply.code(400).send({ error: 'comment_empty' });

      // A reply to a comment on the last allowed level goes to that comment's parent instead (same level, same thread).
      let parent: ParentComment | null = null;
      if (req.body.parentId != null) {
        const findParent = async (id: number) => {
          const [rows] = await db.execute<RowDataPacket[]>(
            'SELECT id, parent_id, root_id, depth FROM comments WHERE id = ? AND post_id = ? AND deleted_at IS NULL',
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

      const id = await insertComment(db, { postId: post.id, userId: req.user!.id, parent, body });
      void notifyComment(db, { postId: post.id, commentId: id, actorId: req.user!.id, parentId: parent?.id ?? null, excerpt: body.slice(0, 140) });
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
      // The text it replaces is kept (comment_revisions), e.g. for moderation.
      await db.execute(
        'INSERT INTO comment_revisions (comment_id, body, replaced_at) SELECT id, body, UTC_TIMESTAMP() FROM comments WHERE id = ? AND body <> ?',
        [found.id, body],
      );
      await db.execute('UPDATE comments SET body = ?, edited_at = UTC_TIMESTAMP() WHERE id = ? AND body <> ?', [body, found.id, body]);
      const [[row]] = await db.execute<RowDataPacket[]>('SELECT body, edited_at FROM comments WHERE id = ?', [found.id]);
      return { body: row.body as string, editedAt: row.edited_at as Date };
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

  // A soft delete, by the person who wrote it or an owner (not by anyone else, whatever their role).
  // Its replies go with it. Owners still see all of them, marked as deleted.
  app.delete<{ Params: { id: string } }>('/comments/:id', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT m.id, m.user_id FROM comments m JOIN posts p ON p.id = m.post_id
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
    return { ids };
  });
};

export default commentRoutes;
