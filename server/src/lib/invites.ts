import crypto from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { inviteEmail, siteLink } from '@/lib/emails';
import type { Lang } from '@/lib/emails';
import { sendMail } from '@/lib/mail';

// Invitations to write: an administrator sends one to an address; whoever opens its link gets an account with the
// author role (or their existing account becomes an author). The link works INVITE_DAYS, once.

const INVITE_DAYS = 14;
export const hashInvite = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** A new link for an invitation (a new one, or sent again: the old link stops working) and its email. */
export async function sendInvite(db: Pool, invite: { id: number; email: string; message: string | null }, inviter: string, lang: Lang) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.execute(`UPDATE invites SET token_hash = ?, expires_at = UTC_TIMESTAMP() + INTERVAL ${INVITE_DAYS} DAY, revoked_at = NULL WHERE id = ?`, [
    hashInvite(token),
    invite.id,
  ]);
  return sendMail(inviteEmail(invite.email, lang, inviter, invite.message, siteLink(`/invitatie?token=${token}`)));
}

/** An invitation by its link, if it still works. */
export async function findInvite(db: Pool, token: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT i.id, i.email, i.message, u.name AS inviter FROM invites i LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > UTC_TIMESTAMP()`,
    [hashInvite(token)],
  );
  const row = rows[0];
  return row ? { id: row.id as number, email: row.email as string, message: row.message as string | null, inviter: (row.inviter as string | null) ?? null } : null;
}

export { INVITE_DAYS };
