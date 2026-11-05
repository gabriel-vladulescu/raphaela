import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { config } from '@/config';
import { ACTIVE_ACCOUNT } from '@/lib/accounts';

export type Role = 'member' | 'author' | 'owner';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  /** In their addresses: /{username}/articole, /{username}/articole-salvate (lib/usernames.ts). */
  username: string;
  /** The uploaded profile picture, else the Google one. */
  picture: string | null;
  /** Whether `picture` is an uploaded one (which can be removed). */
  hasAvatar: boolean;
  role: Role;
  nameConfirmed: boolean;
  /** Agreed to the Terms and Conditions (when signing up, or at the first sign-in with Google). */
  termsAccepted: boolean;
  /** Shown instead of "Author" on their posts. */
  occupation: string | null;
  /** Shown under their name at the end of their posts. */
  quote: string | null;
  /** Anyone may see their articles (/{username}/articole), and their saved ones (/{username}/articole-salvate). */
  publicArticles: boolean;
  publicSaved: boolean;
  /** Signs in with Google too. Its address is always the account's (connecting it sets it; changing it disconnects). */
  google: boolean;
  /** Has a password (accounts made with Google don't, until they set one). */
  hasPassword: boolean;
  /** The address was confirmed (a link sent to it, a new password through it, or Google). */
  emailVerified: boolean;
  /** A new address waiting for its confirmation link to be followed (the email stays the old one until then). */
  pendingEmail: string | null;
}

const SESSION_COOKIE = 'sid';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

// Only a hash of the session token is stored, so a leaked DB can't be replayed as cookies.
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const USER_COLUMNS =
  'u.id, u.email, u.name, u.username, u.picture, u.avatar_url, u.role, u.name_confirmed, u.terms_accepted_at, u.occupation, u.quote, ' +
  'u.public_articles, u.public_saved, u.google_id IS NOT NULL AS google_linked, u.password_hash IS NOT NULL AS has_password, ' +
  "u.email_verified_at, (SELECT t.email FROM email_tokens t WHERE t.user_id = u.id AND t.purpose = 'change' AND t.expires_at > UTC_TIMESTAMP() " +
  'ORDER BY t.created_at DESC LIMIT 1) AS pending_email';

function toSessionUser(row: RowDataPacket): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    username: row.username ?? '',
    picture: row.avatar_url ?? row.picture,
    hasAvatar: row.avatar_url !== null,
    role: row.role,
    nameConfirmed: Boolean(row.name_confirmed),
    termsAccepted: row.terms_accepted_at !== null,
    occupation: row.occupation,
    quote: row.quote,
    publicArticles: Boolean(row.public_articles),
    publicSaved: Boolean(row.public_saved),
    google: Boolean(row.google_linked),
    hasPassword: Boolean(row.has_password),
    emailVerified: row.email_verified_at !== null,
    pendingEmail: (row.pending_email as string | null) ?? null,
  };
}

export async function getSessionUser(db: Pool, req: FastifyRequest): Promise<SessionUser | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${USER_COLUMNS}
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > UTC_TIMESTAMP() AND ${ACTIVE_ACCOUNT}`,
    [hashToken(token)],
  );
  return rows[0] ? toSessionUser(rows[0]) : null;
}

/** Re-reads a user, e.g. to return their profile after a change. */
export async function loadUser(db: Pool, id: number): Promise<SessionUser | null> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = ?`, [id]);
  return rows[0] ? toSessionUser(rows[0]) : null;
}

export async function startSession(db: Pool, reply: FastifyReply, userId: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.execute('DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP()');
  await db.execute(
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL ? SECOND)',
    [hashToken(token), userId, SESSION_TTL_SECONDS],
  );
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Signed out everywhere (a new password set through an emailed link, Google taking over an unconfirmed account). */
export async function endAllSessions(db: Pool, userId: number) {
  await db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

/** After a new password: signed out everywhere else (this browser stays signed in). */
export async function endOtherSessions(db: Pool, req: FastifyRequest, userId: number) {
  const token = req.cookies[SESSION_COOKIE];
  await db.execute('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, token ? hashToken(token) : '']);
}

/** A Google account picked to connect, waiting for its person to confirm (it changes their email). */
export interface GoogleLink {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
  /** When it was picked (ms): it's kept for 15 minutes. */
  at: number;
}
const GOOGLE_LINK_MS = 15 * 60 * 1000;

/** Keeps (or with null, drops) the Google account waiting to be connected, with this browser's session. */
export async function setGoogleLink(db: Pool, req: FastifyRequest, link: GoogleLink | null) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return;
  await db.execute('UPDATE sessions SET google_link = ? WHERE id = ?', [link ? JSON.stringify(link) : null, hashToken(token)]);
}

export async function getGoogleLink(db: Pool, req: FastifyRequest): Promise<GoogleLink | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const [rows] = await db.execute<RowDataPacket[]>('SELECT google_link FROM sessions WHERE id = ?', [hashToken(token)]);
  const value = rows[0]?.google_link as GoogleLink | string | null | undefined;
  const link = typeof value === 'string' ? (JSON.parse(value) as GoogleLink) : (value ?? null);
  return link && Date.now() - link.at < GOOGLE_LINK_MS ? link : null;
}

export async function endSession(db: Pool, req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.execute('DELETE FROM sessions WHERE id = ?', [hashToken(token)]);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Owners are configured by email; anyone else keeps the role stored in the DB. */
export function roleOverrideFor(email: string): Role | null {
  return config.ownerEmails.includes(email.toLowerCase()) ? 'owner' : null;
}

/**
 * Whether an address can be given without Google proving it's theirs (signing up with a password, changing the
 * email). Not an administrator address: it would make whoever typed it an administrator (unless they already are).
 */
export function canClaimEmail(email: string, role: Role | null = null) {
  return roleOverrideFor(email) === null || role === 'owner';
}
