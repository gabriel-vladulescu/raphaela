import type { Pool, ResultSetHeader } from 'mysql2/promise';

/** A comment plus up to two levels of replies; deeper replies attach to the deepest allowed comment. */
export const MAX_DEPTH = 3;

/** Where a reply goes: the comment it answers (its thread and depth). */
export interface ParentComment {
  id: number;
  rootId: number;
  depth: number;
}

/**
 * Stores a comment with its thread (`root_id`: the top-level comment, itself for those) and `depth` (0 for
 * top-level), which the thread queries and the statistics use. Returns the new id.
 */
export async function insertComment(
  db: Pool,
  comment: { postId: number; userId: number; parent: ParentComment | null; body: string; createdAt?: Date },
): Promise<number> {
  const { postId, userId, parent, body, createdAt } = comment;
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO comments (post_id, user_id, parent_id, root_id, depth, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
    [postId, userId, parent?.id ?? null, parent?.rootId ?? null, parent ? parent.depth + 1 : 0, body, createdAt ?? null],
  );
  if (!parent) await db.execute('UPDATE comments SET root_id = id WHERE id = ?', [result.insertId]);
  return result.insertId;
}
