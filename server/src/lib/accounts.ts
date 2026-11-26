import crypto from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { deletedEmail, restoredEmail, siteLink, suspendedEmail, verifyEmail } from '@/lib/emails';
import type { Lang } from '@/lib/emails';
import { sendMail } from '@/lib/mail';
import { logError } from '@/lib/errorLog';
import { notifyAccountDue, notifyCleanupDue } from '@/lib/notifications';
import { retentionTotal } from '@/lib/retention';
import { endSessions } from '@/lib/sessionEnd';
import { removeUpload } from '@/lib/uploads';

// Accounts' lifecycle beyond signing in: links sent by email (confirming the address, a new password, a new
// address), deleting an account (kept at least 3 months, then deleted for good by an administrator, as the person
// chose), and suspensions by administrators.

/** How long a deleted account is kept at least, so it can be restored (through support) if it was a mistake. */
export const RETENTION_MONTHS = 3;

/** SQL (alias `u`): suspended right now (a suspension without an end lasts until it's lifted). */
export const SUSPENDED_NOW = `(u.suspended_at IS NOT NULL AND (u.suspended_until IS NULL OR u.suspended_until > UTC_TIMESTAMP()))`;
/** SQL (alias `u`): an account that can sign in. */
export const ACTIVE_ACCOUNT = `u.deleted_at IS NULL AND NOT ${SUSPENDED_NOW}`;
/** SQL (alias `u`): the columns accountBlock reads. */
export const STATUS_COLUMNS = `u.deleted_at, DATE_ADD(u.deleted_at, INTERVAL ${RETENTION_MONTHS} MONTH) AS purge_on,
  ${SUSPENDED_NOW} AS suspended_now, u.suspended_until, u.suspension_reason`;

export type AccountBlock =
  | { error: 'account_deleted'; purgeOn: Date }
  | { error: 'account_suspended'; until: Date | null; reason: string | null };

/** Why an account can't sign in, for the sign-in page to explain (the row has STATUS_COLUMNS), or null. */
export function accountBlock(row: RowDataPacket): AccountBlock | null {
  if (row.deleted_at) return { error: 'account_deleted', purgeOn: row.purge_on as Date };
  if (Number(row.suspended_now)) return { error: 'account_suspended', until: row.suspended_until as Date | null, reason: row.suspension_reason as string | null };
  return null;
}

/** The sign-in page's address explaining it (after Google sign-in, which is a redirect). */
export function blockQuery(block: AccountBlock) {
  const params = new URLSearchParams({ error: block.error });
  if (block.error === 'account_deleted') params.set('on', block.purgeOn.toISOString());
  else {
    if (block.until) params.set('until', block.until.toISOString());
    if (block.reason) params.set('reason', block.reason);
  }
  return params.toString();
}

// ---- Links sent by email. Only a hash of the token is stored. A link works once, until it expires: using it marks it
// used, and one that stops working before (see LinkEnd) says why. The records stay (an administrator deletes them
// with the old data, lib/retention.ts), so the account's panel in the admin shows what was sent and what happened.

export type TokenPurpose = 'verify' | 'reset' | 'change';
/** Why a link stopped working before it was used. */
export type LinkEnd = 'replaced' | 'password_changed' | 'address_changed' | 'verified' | 'cancelled' | 'google' | 'account_deleted';
const TOKEN_HOURS: Record<TokenPurpose, number> = { verify: 48, reset: 1, change: 24 };
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
/** SQL: a link that still works. */
const OPEN = 'used_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()';
/** At most this many new-password emails an hour for one account (anyone can ask: it mustn't flood an inbox). */
const RESETS_PER_HOUR = 3;

/** Stops a person's links of these kinds that still work, saying why. */
export async function revokeEmailTokens(db: Pool, userId: number, purposes: TokenPurpose[], reason: LinkEnd) {
  await db.query(`UPDATE email_tokens SET revoked_at = UTC_TIMESTAMP(), revoked_reason = ? WHERE user_id = ? AND purpose IN (?) AND ${OPEN}`, [
    reason,
    userId,
    purposes,
  ]);
}

/**
 * A new link. One for a new address replaces a link for another address still waiting (opening that one would
 * switch to the other address). Links confirming the address or setting a password stay valid beside a new one:
 * whichever email is opened works (using one stops the others), and nobody asking for a new password for someone
 * else's address can break the link the owner already has.
 */
export async function createEmailToken(db: Pool, userId: number, purpose: TokenPurpose, email: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  if (purpose === 'change') {
    await db.execute(
      `UPDATE email_tokens SET revoked_at = UTC_TIMESTAMP(), revoked_reason = 'replaced' WHERE user_id = ? AND purpose = 'change' AND email <> ? AND ${OPEN}`,
      [userId, email],
    );
  }
  await db.execute(
    'INSERT INTO email_tokens (id, user_id, purpose, email, expires_at, created_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP() + INTERVAL ? HOUR, UTC_TIMESTAMP())',
    [hashToken(token), userId, purpose, email, TOKEN_HOURS[purpose]],
  );
  return token;
}

/** Whether an account may get another new-password email now (RESETS_PER_HOUR). */
export async function canSendReset(db: Pool, userId: number) {
  const [[row]] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM email_tokens WHERE user_id = ? AND purpose = 'reset' AND created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR",
    [userId],
  );
  return Number(row!.n) < RESETS_PER_HOUR;
}

/** Why a link doesn't work: unknown, already used, stopped (and why), or too old. */
export type LinkError = 'link_invalid' | 'link_used' | 'link_revoked' | 'link_too_old';

export type LinkResult =
  | { ok: true; userId: number; purpose: TokenPurpose; email: string }
  | { ok: false; error: LinkError; reason?: LinkEnd; userId?: number; purpose?: TokenPurpose; email?: string };

async function linkState(db: Pool, id: string, purposes: TokenPurpose[], took: boolean): Promise<LinkResult> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT user_id, purpose, email, used_at, revoked_at, revoked_reason FROM email_tokens WHERE id = ? AND purpose IN (?)',
    [id, purposes],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: 'link_invalid' };
  const link = { userId: row.user_id as number, purpose: row.purpose as TokenPurpose, email: row.email as string };
  if (took) return { ok: true, ...link };
  if (row.used_at) return { ok: false, error: 'link_used', ...link };
  if (row.revoked_at) return { ok: false, error: 'link_revoked', reason: row.revoked_reason as LinkEnd, ...link };
  return { ok: false, error: 'link_too_old', ...link };
}

/** Uses a link, once: marked used (two at the same moment: one wins), or why it doesn't work. */
export async function takeEmailToken(db: Pool, token: string, purposes: TokenPurpose[]): Promise<LinkResult> {
  const id = hashToken(token);
  const [taken] = await db.query<ResultSetHeader>(`UPDATE email_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ? AND purpose IN (?) AND ${OPEN}`, [
    id,
    purposes,
  ]);
  return linkState(db, id, purposes, taken.affectedRows === 1);
}

/** Whether a link would still work, without using it (the new-password page asks before showing its form). */
export async function checkEmailToken(db: Pool, token: string, purpose: TokenPurpose): Promise<LinkResult> {
  const id = hashToken(token);
  const [open] = await db.query<RowDataPacket[]>(`SELECT 1 FROM email_tokens WHERE id = ? AND purpose = ? AND ${OPEN}`, [id, purpose]);
  return linkState(db, id, [purpose], open.length > 0);
}

/** Sends the link that confirms the account's address. */
export async function sendVerification(db: Pool, user: { id: number; email: string; name: string }, lang: Lang) {
  const token = await createEmailToken(db, user.id, 'verify', user.email);
  return sendMail(verifyEmail(user.email, lang, user.name, siteLink(`/confirmare-email?token=${token}`)));
}

// ---- Deleting and restoring accounts.

/** What a person chose when deleting their account: their comments (with the replies under them), and an
 *  author's posts (null: they have none). */
export interface DeletionChoices {
  comments: 'keep' | 'delete';
  posts: 'keep' | 'delete' | null;
}

/** The ids of these comments and of every reply under them. */
async function threadIds(db: Pool, where: string, params: unknown[]) {
  const [rows] = await db.query<RowDataPacket[]>(
    `WITH RECURSIVE thread AS (
       SELECT id FROM comments WHERE ${where}
       UNION ALL
       SELECT c.id FROM comments c JOIN thread t ON c.parent_id = t.id
     )
     SELECT DISTINCT id FROM thread`,
    params,
  );
  return rows.map((row) => row.id as number);
}

/** Whether the person has posts (then they choose what happens to them). */
export async function hasPosts(db: Pool, userId: number) {
  const [rows] = await db.execute<RowDataPacket[]>('SELECT 1 FROM posts WHERE author_id = ? AND deleted_at IS NULL LIMIT 1', [userId]);
  return rows.length > 0;
}

/**
 * Deletes an account at its owner's request: it can't sign in any more, its name disappears from its comments, and
 * what they chose to delete (their comments with the replies under them; an author's posts) is deleted too (marked
 * deleted_with_account, so restoring the account brings it back). It's kept at least RETENTION_MONTHS; after that,
 * administrators are told (accountHousekeeping) and delete it for good themselves (finalizeAccountDeletion), as the
 * person chose. Returns the day it can be deleted for good.
 */
export async function deleteAccount(db: Pool, userId: number, lang: Lang, choices: DeletionChoices) {
  const [marked] = await db.execute<ResultSetHeader>(
    `UPDATE users SET deleted_at = UTC_TIMESTAMP(), deletion_comments = ?, deletion_posts = ?, deletion_due_notified_at = NULL
      WHERE id = ? AND deleted_at IS NULL`,
    [choices.comments, choices.posts, userId],
  );
  if (marked.affectedRows > 0) {
    const [[stamp]] = await db.execute<RowDataPacket[]>('SELECT deleted_at FROM users WHERE id = ?', [userId]);
    const at = stamp!.deleted_at as Date;
    if (choices.comments === 'delete') {
      const ids = await threadIds(db, 'user_id = ? AND deleted_at IS NULL', [userId]);
      if (ids.length) {
        await db.query('UPDATE comments SET deleted_at = ?, deleted_by = ?, deleted_with_account = ? WHERE id IN (?) AND deleted_at IS NULL', [
          at,
          userId,
          userId,
          ids,
        ]);
        // Their reports are settled: the comments are gone (they come back without them if the account is restored).
        await db.query(`UPDATE comment_reports SET resolved_at = UTC_TIMESTAMP(), resolution = 'removed' WHERE comment_id IN (?) AND resolved_at IS NULL`, [ids]);
      }
    }
    if (choices.posts === 'delete') {
      await db.execute('UPDATE posts SET deleted_at = ?, deleted_with_account = ? WHERE author_id = ? AND deleted_at IS NULL', [at, userId, userId]);
    }
  }
  await db.execute('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]);
  await endSessions(db, userId, 'account_deleted');
  await revokeEmailTokens(db, userId, ['verify', 'reset', 'change'], 'account_deleted');
  // No more newsletter emails either (restoring the account doesn't subscribe them again).
  await db.execute(
    'UPDATE newsletter_subscribers SET unsubscribed_at = COALESCE(unsubscribed_at, UTC_TIMESTAMP()) WHERE user_id = ? OR email = (SELECT email FROM users WHERE id = ?)',
    [userId, userId],
  );
  const [[row]] = await db.execute<RowDataPacket[]>(
    `SELECT email, name, DATE_ADD(deleted_at, INTERVAL ${RETENTION_MONTHS} MONTH) AS purge_on FROM users WHERE id = ?`,
    [userId],
  );
  const purgeOn = row!.purge_on as Date;
  void sendMail(deletedEmail(row!.email as string, lang, row!.name as string, purgeOn));
  return purgeOn;
}

/** Undoes a deletion that hasn't been carried out yet (administrators, after a support ticket): with the comments
 *  and posts it took away. */
export async function restoreAccount(db: Pool, userId: number) {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE users SET deleted_at = NULL, deletion_comments = NULL, deletion_posts = NULL, deletion_due_notified_at = NULL
      WHERE id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL`,
    [userId],
  );
  if (result.affectedRows === 0) return false;
  await db.execute('UPDATE comments SET deleted_at = NULL, deleted_by = NULL, deleted_with_account = NULL WHERE deleted_with_account = ?', [userId]);
  await db.execute('UPDATE posts SET deleted_at = NULL, deleted_with_account = NULL WHERE deleted_with_account = ?', [userId]);
  await db.execute("DELETE FROM notifications WHERE type = 'account_due' AND account_id = ?", [userId]);
  const [[row]] = await db.execute<RowDataPacket[]>('SELECT email, name FROM users WHERE id = ?', [userId]);
  void sendMail(restoredEmail(row!.email as string, 'ro', row!.name as string));
  return true;
}

/** The uploaded images (banner and the ones in the text) of these posts that no other post uses. */
async function unusedUploads(db: Pool, postIds: number[]) {
  if (postIds.length === 0) return [];
  const [rows] = await db.query<RowDataPacket[]>('SELECT banner_url, content_html FROM posts WHERE id IN (?)', [postIds]);
  const urls = new Set<string>();
  for (const row of rows) {
    if (typeof row.banner_url === 'string' && row.banner_url.startsWith('/uploads/')) urls.add(row.banner_url);
    for (const match of String(row.content_html).matchAll(/\/uploads\/[\w.-]+/g)) urls.add(match[0]);
  }
  const unused: string[] = [];
  for (const url of urls) {
    const [others] = await db.query<RowDataPacket[]>('SELECT 1 FROM posts WHERE id NOT IN (?) AND (banner_url = ? OR content_html LIKE ?) LIMIT 1', [
      postIds,
      url,
      `%${url}%`,
    ]);
    if (others.length === 0) unused.push(url);
  }
  return unused;
}

export type FinalizeResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Deletes an account for good, once its RETENTION_MONTHS are up, as the person chose; an administrator does it from
 * the admin panel. Comments: kept (under "deleted account") or deleted for good with the replies under them. An
 * author's posts: deleted for good (with their images), or kept and moved to another author (`transferTo`, required
 * then). Everything else that identifies the person goes: email, name, pictures, password, Google, likes, saved posts,
 * reactions, notifications, devices. The row stays as an empty shell (purged_at), since comments point at it; the
 * address is free again.
 */
export async function finalizeAccountDeletion(db: Pool, userId: number, transferTo: number | null): Promise<FinalizeResult> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, avatar_url, deletion_comments, deletion_posts, deleted_at <= UTC_TIMESTAMP() - INTERVAL ${RETENTION_MONTHS} MONTH AS due
       FROM users WHERE id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL`,
    [userId],
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 404, error: 'not_found' };
  if (!Number(row.due)) return { ok: false, status: 409, error: 'deletion_not_due' };

  const [posts] = await db.execute<RowDataPacket[]>('SELECT id FROM posts WHERE author_id = ?', [userId]);
  const postIds = posts.map((p) => p.id as number);
  const deletePosts = row.deletion_posts === 'delete';
  if (postIds.length && !deletePosts) {
    const [target] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM users WHERE id = ? AND role = 'author' AND deleted_at IS NULL AND purged_at IS NULL",
      [transferTo ?? 0],
    );
    if (!target[0]) return { ok: false, status: 400, error: 'transfer_author_required' };
  }

  if (postIds.length) {
    if (deletePosts) {
      const images = await unusedUploads(db, postIds);
      await db.query('DELETE FROM posts WHERE id IN (?)', [postIds]);
      for (const url of images) await removeUpload(url, '');
    } else {
      await db.execute('UPDATE posts SET author_id = ?, deleted_with_account = NULL WHERE author_id = ?', [transferTo, userId]);
    }
  }
  // Their books go with their posts, or to the same author; empty ones (no chapters) simply go.
  if (deletePosts || postIds.length === 0) await db.execute('DELETE FROM books WHERE author_id = ?', [userId]);
  else await db.execute('UPDATE books SET author_id = ? WHERE author_id = ?', [transferTo, userId]);
  await db.execute('UPDATE cover_templates SET created_by = NULL WHERE created_by = ?', [userId]);
  if (row.deletion_comments === 'delete') {
    // Their comments, and every reply under them, deleted with the account (the replies go with a deleted parent).
    await db.execute('DELETE FROM comments WHERE user_id = ? OR deleted_with_account = ?', [userId, userId]);
  }

  for (const table of ['post_bookmarks', 'post_likes', 'comment_reactions', 'notifications', 'push_subscriptions', 'sessions', 'email_tokens', 'account_changes', 'reading_progress', 'reading_days']) {
    await db.execute(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
  }
  await db.execute('UPDATE notifications SET actor_id = NULL WHERE actor_id = ?', [userId]);
  await db.execute("DELETE FROM notifications WHERE type = 'account_due' AND account_id = ?", [userId]);
  // Whom they followed and who followed them, and their newsletter subscription (by account or address).
  await db.execute('DELETE FROM author_follows WHERE user_id = ? OR author_id = ?', [userId, userId]);
  await db.execute('DELETE FROM newsletter_subscribers WHERE user_id = ? OR email = (SELECT email FROM users WHERE id = ?)', [userId, userId]);
  for (const table of ['page_views', 'events', 'support_tickets']) await db.execute(`UPDATE ${table} SET user_id = NULL WHERE user_id = ?`, [userId]);
  await db.execute('UPDATE comment_reports SET reporter_id = NULL WHERE reporter_id = ?', [userId]);
  // The emails sent to them, and their name in the administrators' log.
  await db.execute('DELETE FROM email_log WHERE to_email = (SELECT email FROM users WHERE id = ?)', [userId]);
  await db.execute("UPDATE admin_log SET target_label = CONCAT('Cont șters definitiv #', target_id) WHERE target_type = 'user' AND target_id = ?", [userId]);
  await db.execute(
    `UPDATE users SET email = CONCAT('deleted-', id, '@deleted.invalid'), email_verified_at = NULL, name = '—', username = NULL,
            picture = NULL, avatar_url = NULL, google_id = NULL, password_hash = NULL, occupation = NULL, quote = NULL,
            notify_settings = NULL, public_articles = 0, public_books = 0, public_saved = 0, suspension_reason = NULL, purged_at = UTC_TIMESTAMP()
      WHERE id = ?`,
    [userId],
  );
  await removeUpload((row.avatar_url as string | null) ?? null, 'avatar-');
  return { ok: true };
}

/**
 * Hourly: tells administrators about deleted accounts whose RETENTION_MONTHS are up (once each; they delete them for
 * good from the admin panel), and about data older than what the Terms promise (lib/retention.ts; at most once a
 * week; they delete it from the admin panel too). It deletes nothing itself.
 */
export async function accountHousekeeping(db: Pool) {
  try {
    const [due] = await db.query<RowDataPacket[]>(
      `SELECT id, name FROM users
        WHERE deleted_at IS NOT NULL AND purged_at IS NULL AND deletion_due_notified_at IS NULL
          AND deleted_at <= UTC_TIMESTAMP() - INTERVAL ${RETENTION_MONTHS} MONTH`,
    );
    for (const row of due) {
      await db.execute('UPDATE users SET deletion_due_notified_at = UTC_TIMESTAMP() WHERE id = ?', [row.id]);
      await notifyAccountDue(db, { accountId: row.id as number, name: row.name as string });
    }
    const old = await retentionTotal(db);
    if (old > 0) await notifyCleanupDue(db, old);
  } catch (err) {
    logError('job', 'housekeeping', err);
  }
}

// ---- Suspensions (administrators). The person is signed out everywhere and can't sign in until it ends.

export async function suspendAccount(db: Pool, userId: number, byId: number, days: number | null, reason: string | null) {
  await db.execute(
    `UPDATE users SET suspended_at = UTC_TIMESTAMP(), suspended_until = IF(? IS NULL, NULL, UTC_TIMESTAMP() + INTERVAL ? DAY),
            suspension_reason = ?, suspended_by = ?
      WHERE id = ?`,
    [days, days ?? 0, reason, byId, userId],
  );
  await endSessions(db, userId, 'suspended');
  // They hear about it by email too (else only when they try to sign in).
  const [[row]] = await db.execute<RowDataPacket[]>('SELECT email, name, suspended_until FROM users WHERE id = ?', [userId]);
  if (row) void sendMail(suspendedEmail(row.email as string, 'ro', row.name as string, row.suspended_until as Date | null, reason));
}

export async function liftSuspension(db: Pool, userId: number) {
  await db.execute('UPDATE users SET suspended_at = NULL, suspended_until = NULL, suspension_reason = NULL, suspended_by = NULL WHERE id = ?', [userId]);
}
