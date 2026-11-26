import type { Pool } from 'mysql2/promise';

// Sign-ins (sessions) that end before they run out aren't deleted: each is marked ended, with why, so an account's
// sign-ins can be looked at later (its panel in the admin, the data export). The records go when an administrator
// deletes old data (lib/retention.ts). What a Google account waiting to be connected left on one goes at once.

/** Why a sign-in ended. */
export type SessionEnd = 'signed_out' | 'password_changed' | 'password_reset' | 'google' | 'suspended' | 'account_deleted' | 'admin';

/** Ends an account's sign-ins that still work, except `keep` (a session id: this browser's). */
export async function endSessions(db: Pool, userId: number, reason: SessionEnd, keep: string | null = null) {
  await db.execute(
    `UPDATE sessions SET ended_at = UTC_TIMESTAMP(), end_reason = ?, google_link = NULL
      WHERE user_id = ? AND ended_at IS NULL AND expires_at > UTC_TIMESTAMP() AND id <> ?`,
    [reason, userId, keep ?? ''],
  );
}

/** Ends one sign-in (signing out). */
export async function endSessionById(db: Pool, id: string, reason: SessionEnd) {
  await db.execute("UPDATE sessions SET ended_at = UTC_TIMESTAMP(), end_reason = ?, google_link = NULL WHERE id = ? AND ended_at IS NULL", [reason, id]);
}
