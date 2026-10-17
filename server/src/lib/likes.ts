import type { FastifyRequest } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { notifyLike } from '@/lib/notifications';
import { VISIBLE_POST } from '@/lib/posts';

// Post likes are public: an account's when signed in, otherwise the browser's (its visitor cookie; a browser that
// lost its cookie is recognised by its fingerprint). Each like is a row; taking it back marks it (removed_at), and
// `liker` ('u<id>' / 'v<visitor id>') is unique per post while the like stands.

/** The person's live like on a post, if any. */
async function findLike(db: Pool, req: FastifyRequest, postId: number) {
  const [rows] = req.user
    ? await db.execute<RowDataPacket[]>('SELECT id, visitor_id FROM post_likes WHERE post_id = ? AND user_id = ? AND removed_at IS NULL', [
        postId,
        req.user.id,
      ])
    : await db.execute<RowDataPacket[]>(
        `SELECT id, visitor_id FROM post_likes
          WHERE post_id = ? AND user_id IS NULL AND removed_at IS NULL AND (visitor_id = ? OR fingerprint = ?)
          ORDER BY visitor_id = ? DESC LIMIT 1`,
        [postId, req.visitor.id, req.visitor.fingerprint, req.visitor.id],
      );
  return rows[0] ? { id: rows[0].id as number, visitorId: rows[0].visitor_id as string | null } : null;
}

const isDuplicate = (err: unknown) => (err as { code?: string }).code === 'ER_DUP_ENTRY';

/** Likes a post, or takes the like back. Repeats (double taps, two tabs) change nothing. */
export async function setLike(db: Pool, req: FastifyRequest, postId: number, liked: boolean) {
  const found = await findLike(db, req, postId);
  const { id: visitorId, fingerprint } = req.visitor;
  if (liked && !found) {
    const liker = req.user ? `u${req.user.id}` : `v${visitorId}`;
    try {
      await db.execute('INSERT INTO post_likes (post_id, user_id, visitor_id, fingerprint, liker) VALUES (?, ?, ?, ?, ?)', [
        postId,
        req.user?.id ?? null,
        visitorId,
        fingerprint,
        liker,
      ]);
      void notifyLike(db, { postId, actorId: req.user?.id ?? null });
    } catch (err) {
      if (!isDuplicate(err)) throw err;
    }
  } else if (liked && found && !req.user && found.visitorId !== visitorId) {
    // The same browser under a new cookie: its like goes with it (so it can also take it back).
    await db.execute('UPDATE post_likes SET visitor_id = ?, liker = ? WHERE id = ?', [visitorId, `v${visitorId}`, found.id]);
  } else if (!liked && found) {
    await db.execute('UPDATE post_likes SET removed_at = UTC_TIMESTAMP(), liker = NULL WHERE id = ?', [found.id]);
  }
}

export async function likeCount(db: Pool, postId: number) {
  const [[row]] = await db.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ? AND removed_at IS NULL', [postId]);
  return Number(row!.n);
}

/** The posts this person likes (account, or this browser for guests). */
export async function likedPostIds(db: Pool, req: FastifyRequest): Promise<number[]> {
  const [rows] = req.user
    ? await db.execute<RowDataPacket[]>('SELECT post_id FROM post_likes WHERE user_id = ? AND removed_at IS NULL', [req.user.id])
    : await db.execute<RowDataPacket[]>(
        'SELECT DISTINCT post_id FROM post_likes WHERE user_id IS NULL AND removed_at IS NULL AND (visitor_id = ? OR fingerprint = ?)',
        [req.visitor.id, req.visitor.fingerprint],
      );
  return rows.map((row) => row.post_id as number);
}

/** Likes several posts at once (likes a browser kept locally before likes were stored on the server). */
export async function importLikes(db: Pool, req: FastifyRequest, postIds: number[]) {
  if (postIds.length === 0) return;
  const [visible] = await db.query<RowDataPacket[]>(`SELECT p.id FROM posts p WHERE p.id IN (?) AND ${VISIBLE_POST}`, [postIds]);
  for (const row of visible) await setLike(db, req, row.id as number, true);
}

/** After signing in, this browser's guest likes become the account's (a post liked both ways keeps one like). */
export async function claimGuestLikes(db: Pool, userId: number, visitorId: string) {
  await db.execute(
    `UPDATE post_likes g JOIN post_likes u ON u.post_id = g.post_id AND u.user_id = ? AND u.removed_at IS NULL
        SET g.removed_at = UTC_TIMESTAMP(), g.liker = NULL
      WHERE g.visitor_id = ? AND g.user_id IS NULL AND g.removed_at IS NULL`,
    [userId, visitorId],
  );
  await db.execute(
    `UPDATE post_likes SET user_id = ?, liker = CONCAT('u', ?)
      WHERE visitor_id = ? AND user_id IS NULL AND removed_at IS NULL`,
    [userId, userId, visitorId],
  );
}
