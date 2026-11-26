import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { SessionUser } from '@/lib/session';
import { logError } from '@/lib/errorLog';

// What administrators did, for the admin panel's log (who changed what, and when). Each entry keeps the
// administrator's name and the target's label as they were, so it still reads well after either changes.

export type TargetType = 'user' | 'comment' | 'post' | 'book' | 'category' | 'support' | 'settings';

export interface AdminTarget {
  type: TargetType;
  id: number | null;
  /** What it was called then: a person's name, a post's title, a comment's beginning, a settings section. */
  label: string;
}

/**
 * Notes an administrator's action. Never throws: the action itself already happened. `coalesceMinutes`: not again
 * for the same action on the same target by the same administrator within that time (e.g. saving a post often).
 */
export async function logAdmin(
  db: Pool,
  admin: SessionUser,
  action: string,
  target: AdminTarget,
  details: Record<string, unknown> | null = null,
  coalesceMinutes = 0,
) {
  try {
    if (coalesceMinutes > 0) {
      const [recent] = await db.execute<RowDataPacket[]>(
        `SELECT 1 FROM admin_log WHERE admin_id = ? AND action = ? AND target_type = ? AND target_id <=> ?
            AND created_at > UTC_TIMESTAMP() - INTERVAL ? MINUTE LIMIT 1`,
        [admin.id, action, target.type, target.id, coalesceMinutes],
      );
      if (recent.length) return;
    }
    await db.execute(
      `INSERT INTO admin_log (created_at, admin_id, admin_name, action, target_type, target_id, target_label, details)
       VALUES (UTC_TIMESTAMP(), ?, ?, ?, ?, ?, ?, ?)`,
      [admin.id, admin.name.slice(0, 80), action, target.type, target.id, target.label.slice(0, 255), details ? JSON.stringify(details) : null],
    );
  } catch (err) {
    logError('other', 'admin log', err);
  }
}

/** A comment as a log label: its first words. */
export const commentLabel = (body: string) => (body.length > 80 ? `${body.slice(0, 79)}…` : body);
