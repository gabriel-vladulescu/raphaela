import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import type { TokenPayload } from 'google-auth-library';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '@/config';
import {
  accountBlock,
  ACTIVE_ACCOUNT,
  blockQuery,
  canSendReset,
  checkEmailToken,
  createEmailToken,
  revokeEmailTokens,
  sendVerification,
  STATUS_COLUMNS,
  takeEmailToken,
} from '@/lib/accounts';
import type { LinkResult } from '@/lib/accounts';
import { recordAccountChange } from '@/lib/accountChanges';
import type { AccountBlock } from '@/lib/accounts';
import { logSignIn } from '@/lib/authLog';
import type { SignInOutcome } from '@/lib/authLog';
import { langOf, resetEmail, siteLink } from '@/lib/emails';
import { mailConfigured, sendMail } from '@/lib/mail';
import { burnPasswordCheck, hashPassword, verifyPassword } from '@/lib/password';
import { claimGuestLikes } from '@/lib/likes';
import { canClaimEmail, endAllSessions, endSession, roleOverrideFor, setGoogleLink, startSession } from '@/lib/session';
import type { SessionUser } from '@/lib/session';
import { assignUsername } from '@/lib/usernames';

const STATE_COOKIE = 'oauth_state';
const NEXT_COOKIE = 'oauth_next';
/** Set when Google sign-in started from a page that asked for (or stated) agreement to the Terms. */
const TERMS_COOKIE = 'oauth_terms';
/** Set when a signed-in person is connecting a Google account to theirs (Profile), not signing in. */
const LINK_COOKIE = 'oauth_link';

/** Where to land after Google sign-in: a path on our own app, never another site. */
function safeNextPath(value: unknown): string {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) && value.length <= 500 ? value : '/';
}

/**
 * Signs in with Google: the account with this Google account, else the one with its (Google-verified) address, else
 * a new one. `acceptedTerms`: a new account records when its owner agreed to the Terms (existing ones are left as they
 * are). A deleted or suspended account isn't signed in: the sign-in page says why.
 */
async function upsertGoogleUser(
  db: Pool,
  profile: TokenPayload & { email: string },
  acceptedTerms: boolean,
): Promise<{ userId: number } | { block: AccountBlock; userId: number }> {
  const email = profile.email.toLowerCase();
  const role = roleOverrideFor(email);
  const select = `SELECT u.id, u.email_verified_at, ${STATUS_COLUMNS} FROM users u`;

  const [byGoogleId] = await db.execute<RowDataPacket[]>(`${select} WHERE u.google_id = ?`, [profile.sub]);
  const [byEmail] = byGoogleId[0] ? [[]] : await db.execute<RowDataPacket[]>(`${select} WHERE u.email = ?`, [email]);
  const existing = byGoogleId[0] ?? byEmail[0];

  if (existing) {
    const block = accountBlock(existing);
    if (block) return { block, userId: existing.id as number };
    // An account with this address that never confirmed it: whoever made it didn't prove the address was theirs, and
    // Google just did. It becomes this person's alone: its password goes and it's signed out everywhere else.
    if (!byGoogleId[0] && existing.email_verified_at === null) {
      await db.execute('UPDATE users SET password_hash = NULL WHERE id = ?', [existing.id]);
      await endAllSessions(db, existing.id as number, 'google');
      await revokeEmailTokens(db, existing.id as number, ['reset'], 'google');
    }
    // Links Google to an email/password account with the same (Google-verified) email.
    await db.execute(
      `UPDATE users SET google_id = ?, picture = COALESCE(?, picture), role = COALESCE(?, role),
              email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()), last_login_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [profile.sub, profile.picture ?? null, role, existing.id],
    );
    // Google proved the address: links to confirm it have nothing left to do.
    await revokeEmailTokens(db, existing.id as number, ['verify'], 'verified');
    return { userId: existing.id as number };
  }

  const name = (profile.name?.trim() || email.split('@')[0]).slice(0, 80);
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO users (google_id, email, email_verified_at, name, picture, role, terms_accepted_at)
     VALUES (?, ?, UTC_TIMESTAMP(), ?, ?, ?, ${acceptedTerms ? 'UTC_TIMESTAMP()' : 'NULL'})`,
    [profile.sub, email, name, profile.picture ?? null, role ?? 'member'],
  );
  await assignUsername(db, result.insertId, name);
  return { userId: result.insertId };
}

/**
 * Connects the Google account to the signed-in one; returns how it went, for /profil?google=…. One with the
 * account's own address is connected at once; another address would become the account's, so it waits, with the
 * session, for them to confirm it (routes/me.ts).
 */
async function linkGoogle(db: Pool, req: FastifyRequest, user: SessionUser, profile: TokenPayload & { email: string }) {
  const email = profile.email.toLowerCase();
  const [linked] = await db.execute<RowDataPacket[]>('SELECT id FROM users WHERE google_id = ?', [profile.sub]);
  if (linked[0]) return linked[0].id === user.id ? 'already' : 'google_taken';
  if (email === user.email) {
    await db.execute(
      `UPDATE users SET google_id = ?, picture = COALESCE(?, picture), role = COALESCE(?, role),
              email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP())
        WHERE id = ?`,
      [profile.sub, profile.picture ?? null, roleOverrideFor(email), user.id],
    );
    return 'linked';
  }
  const [used] = await db.execute<RowDataPacket[]>('SELECT id FROM users WHERE email = ? AND id <> ?', [email, user.id]);
  if (used[0]) return 'email_in_use';
  await setGoogleLink(db, req, { sub: profile.sub, email, name: profile.name ?? null, picture: profile.picture ?? null, at: Date.now() });
  return 'confirm';
}

interface Credentials {
  email: string;
  password: string;
}

const credentialProperties = {
  email: { type: 'string', format: 'email', maxLength: 255 },
  password: { type: 'string', minLength: 8, maxLength: 200 },
} as const;
/** The language the page was in, for the email it makes the server send. */
const langSchema = { type: 'string', enum: ['ro', 'en'] } as const;
const tokenSchema = { type: 'string', minLength: 20, maxLength: 100 } as const;

const authRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;
  const google = new OAuth2Client({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: config.google.redirectUri,
  });
  const tempCookie = { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/api/auth', maxAge: 600 } as const;
  const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  // Step 1: send the browser to Google's account chooser. `link=1`: to connect it to the signed-in account.
  app.get<{ Querystring: { next?: string; terms?: string; link?: string } }>('/auth/google', async (req, reply) => {
    const state = crypto.randomBytes(32).toString('hex');
    reply.setCookie(STATE_COOKIE, state, tempCookie);
    reply.setCookie(NEXT_COOKIE, safeNextPath(req.query.next), tempCookie);
    if (req.query.terms === '1') reply.setCookie(TERMS_COOKIE, '1', tempCookie);
    else reply.clearCookie(TERMS_COOKIE, { path: '/api/auth' });
    if (req.query.link === '1' && req.user) reply.setCookie(LINK_COOKIE, '1', tempCookie);
    else reply.clearCookie(LINK_COOKIE, { path: '/api/auth' });
    return reply.redirect(
      google.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, prompt: 'select_account' }),
    );
  });

  // Step 2: Google redirects back here with a one-time code we exchange for the user's profile.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/auth/google/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;
      const expectedState = req.cookies[STATE_COOKIE];
      const next = safeNextPath(req.cookies[NEXT_COOKIE]);
      const acceptedTerms = req.cookies[TERMS_COOKIE] === '1';
      // Connecting Google to the signed-in account (Profile); signed out since, it's a sign-in.
      const linking = req.cookies[LINK_COOKIE] === '1' && req.user !== null;
      reply.clearCookie(STATE_COOKIE, { path: '/api/auth' });
      reply.clearCookie(NEXT_COOKIE, { path: '/api/auth' });
      reply.clearCookie(TERMS_COOKIE, { path: '/api/auth' });
      reply.clearCookie(LINK_COOKIE, { path: '/api/auth' });
      const profilePage = `${config.appUrl}/profil`;
      const failRedirect = linking ? `${profilePage}?google=error` : `${config.appUrl}/login?error=google`;

      if (error || !code || !state || state !== expectedState) {
        req.log.warn({ error }, 'Google sign-in rejected');
        // Closing Google's account chooser isn't an error worth a message when connecting.
        return reply.redirect(linking && error === 'access_denied' ? profilePage : failRedirect);
      }

      try {
        const { tokens } = await google.getToken(code);
        if (!tokens.id_token) throw new Error('Google did not return an ID token');
        const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
        const profile = ticket.getPayload();
        if (!profile?.email || !profile.email_verified) throw new Error('Google account has no verified email');

        if (linking) {
          const outcome = await linkGoogle(db, req, req.user!, { ...profile, email: profile.email });
          return reply.redirect(`${profilePage}?google=${outcome}`);
        }
        const outcome = await upsertGoogleUser(db, { ...profile, email: profile.email }, acceptedTerms);
        const email = profile.email.toLowerCase();
        if ('block' in outcome) {
          await logSignIn(db, req, { userId: outcome.userId, email, method: 'google', outcome: blockOutcome(outcome.block) });
          return reply.redirect(`${config.appUrl}/login?${blockQuery(outcome.block)}`);
        }
        const { userId } = outcome;
        await startSession(db, reply, userId);
        await logSignIn(db, req, { userId, email, method: 'google', outcome: 'ok' });
        await claimGuestLikes(db, userId, req.visitor.id); // likes given before signing in
        return reply.redirect(`${config.appUrl}${next}`);
      } catch (err) {
        req.log.error(err, 'Google sign-in failed');
        if (!linking) await logSignIn(db, req, { userId: null, email: null, method: 'google', outcome: 'failed' });
        return reply.redirect(failRedirect);
      }
    },
  );

  // Signing up needs agreeing to the Terms and Conditions (the checkbox on the register page). The address gets a
  // link to confirm it (`lang`: the language the page was in, for that email).
  app.post<{ Body: Credentials & { name: string; acceptTerms?: boolean; lang?: string } }>(
    '/auth/register',
    {
      config: authRateLimit,
      schema: {
        body: {
          type: 'object',
          required: ['name', 'email', 'password'],
          additionalProperties: false,
          properties: { name: { type: 'string', maxLength: 80 }, acceptTerms: { type: 'boolean' }, lang: langSchema, ...credentialProperties },
        },
      },
    },
    async (req, reply) => {
      const name = req.body.name.trim();
      const email = req.body.email.trim().toLowerCase();
      if (req.body.acceptTerms !== true) return reply.code(400).send({ error: 'terms_required' });
      if (name.length < 2) return reply.code(400).send({ error: 'name_invalid' });
      // The account's address is confirmed by an emailed link: no account without a way to send it (Google signs up
      // without one, the address proven).
      if (!mailConfigured()) return reply.code(503).send({ error: 'email_unavailable' });

      const [existing] = await db.execute<RowDataPacket[]>('SELECT id FROM users WHERE email = ?', [email]);
      if (existing[0]) return reply.code(409).send({ error: 'email_taken' });
      // An administrator address only through Google, which proves it's theirs (else typing it would be enough).
      if (!canClaimEmail(email)) return reply.code(400).send({ error: 'email_google_only' });

      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO users (email, password_hash, name, name_confirmed, role, terms_accepted_at)
         VALUES (?, ?, ?, 1, ?, UTC_TIMESTAMP())`,
        [email, await hashPassword(req.body.password), name, roleOverrideFor(email) ?? 'member'],
      );
      await assignUsername(db, result.insertId, name);
      await startSession(db, reply, result.insertId);
      await logSignIn(db, req, { userId: result.insertId, email, method: 'signup', outcome: 'ok' });
      await claimGuestLikes(db, result.insertId, req.visitor.id); // likes given before signing in
      void sendVerification(db, { id: result.insertId, email, name }, langOf(req.body.lang));
      return { ok: true };
    },
  );

  app.post<{ Body: Credentials }>(
    '/auth/login',
    {
      config: authRateLimit,
      schema: {
        body: { type: 'object', required: ['email', 'password'], additionalProperties: false, properties: credentialProperties },
      },
    },
    async (req, reply) => {
      const email = req.body.email.trim().toLowerCase();
      const [rows] = await db.execute<RowDataPacket[]>(`SELECT u.id, u.password_hash, ${STATUS_COLUMNS} FROM users u WHERE u.email = ?`, [email]);
      const user = rows[0];

      const attempt = (outcome: SignInOutcome) => logSignIn(db, req, { userId: (user?.id as number | undefined) ?? null, email, method: 'password', outcome });
      if (!user?.password_hash) {
        await burnPasswordCheck(req.body.password);
        await attempt(user ? 'google_only' : 'unknown_email');
        return reply.code(401).send({ error: user ? 'use_google' : 'invalid_credentials' });
      }
      if (!(await verifyPassword(req.body.password, user.password_hash))) {
        await attempt('wrong_password');
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      // Said only to whoever knows the password: a deleted account (and when it will be gone), or a suspended one.
      const block = accountBlock(user);
      if (block) {
        await attempt(blockOutcome(block));
        return reply.code(403).send(block);
      }

      await db.execute(
        'UPDATE users SET role = COALESCE(?, role), last_login_at = CURRENT_TIMESTAMP WHERE id = ?',
        [roleOverrideFor(email), user.id],
      );
      await startSession(db, reply, user.id);
      await attempt('ok');
      await claimGuestLikes(db, user.id, req.visitor.id); // likes given before signing in
      return { ok: true };
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    await endSession(db, req, reply);
    return { ok: true };
  });

  // ---- Forgotten password: a link by email to choose a new one. The answer is the same whether or not there's an
  // account with that address (it isn't a way to find out who has one).
  app.post<{ Body: { email: string; lang?: string } }>(
    '/auth/forgot-password',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: { email: credentialProperties.email, lang: langSchema },
        },
      },
    },
    async (req, reply) => {
      if (!mailConfigured()) return reply.code(503).send({ error: 'email_unavailable' });
      const email = req.body.email.trim().toLowerCase();
      const [rows] = await db.execute<RowDataPacket[]>(`SELECT u.id, u.name FROM users u WHERE u.email = ? AND ${ACTIVE_ACCOUNT}`, [email]);
      const user = rows[0];
      // (Past a few an hour, nothing more is sent, so an inbox can't be flooded; the answer stays the same.)
      if (user && (await canSendReset(db, user.id as number))) {
        const token = await createEmailToken(db, user.id as number, 'reset', email);
        void sendMail(resetEmail(email, langOf(req.body.lang), user.name as string, siteLink(`/resetare-parola?token=${token}`)));
      }
      return { ok: true };
    },
  );

  // Whether a new-password link still works (the page asks before showing its form), or why not.
  app.get<{ Querystring: { token?: string } }>(
    '/auth/reset-password',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const link = await checkEmailToken(db, String(req.query.token ?? '').slice(0, 100), 'reset');
      return link.ok ? { valid: true } : { valid: false, ...linkProblem(link) };
    },
  );

  // The new password, through the emailed link. It also confirms the address (the link reached it); every other
  // browser is signed out, and this one signed in.
  app.post<{ Body: { token: string; password: string } }>(
    '/auth/reset-password',
    {
      config: authRateLimit,
      schema: {
        body: {
          type: 'object',
          required: ['token', 'password'],
          additionalProperties: false,
          properties: { token: tokenSchema, password: credentialProperties.password },
        },
      },
    },
    async (req, reply) => {
      const used = await takeEmailToken(db, req.body.token, ['reset']);
      if (!used.ok) return reply.code(400).send(linkProblem(used));
      const [rows] = await db.execute<RowDataPacket[]>(`SELECT u.id, u.email, ${STATUS_COLUMNS} FROM users u WHERE u.id = ?`, [used.userId]);
      const user = rows[0];
      if (!user || user.email !== used.email) return reply.code(400).send({ error: 'link_invalid' }); // the address changed since
      const block = accountBlock(user);
      if (block) {
        await logSignIn(db, req, { userId: used.userId, email: used.email, method: 'reset', outcome: blockOutcome(block) });
        return reply.code(403).send(block);
      }
      await db.execute('UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = ?', [
        await hashPassword(req.body.password),
        used.userId,
      ]);
      // The other new-password links stop (the password is set), and so do links to confirm the address (this did).
      await revokeEmailTokens(db, used.userId, ['reset'], 'password_changed');
      await revokeEmailTokens(db, used.userId, ['verify'], 'verified');
      await endAllSessions(db, used.userId, 'password_reset');
      await startSession(db, reply, used.userId);
      await logSignIn(db, req, { userId: used.userId, email: used.email, method: 'reset', outcome: 'ok' });
      return { ok: true };
    },
  );

  // A link from an email: confirms the account's address, or a new address (which then becomes the account's, and
  // stops signing in with Google, whose address is always the account's).
  app.post<{ Body: { token: string } }>(
    '/auth/verify-email',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { body: { type: 'object', required: ['token'], additionalProperties: false, properties: { token: tokenSchema } } },
    },
    async (req, reply) => {
      const used = await takeEmailToken(db, req.body.token, ['verify', 'change']);
      if (!used.ok) {
        // Opened again (or opened first by the mail's link checker), when what it does is done: said so, not an error.
        if ((used.error === 'link_used' || used.error === 'link_revoked') && used.userId) {
          const [[row]] = await db.execute<RowDataPacket[]>('SELECT email, email_verified_at, deleted_at FROM users WHERE id = ?', [used.userId]);
          if (row && !row.deleted_at && row.email === used.email && row.email_verified_at) return { ok: true, purpose: used.purpose, email: used.email, already: true };
        }
        return reply.code(400).send(linkProblem(used));
      }
      if (used.purpose === 'verify') {
        const [result] = await db.execute<ResultSetHeader>(
          'UPDATE users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = ? AND email = ? AND deleted_at IS NULL',
          [used.userId, used.email],
        );
        if (result.affectedRows === 0) return reply.code(400).send({ error: 'link_invalid' });
        await revokeEmailTokens(db, used.userId, ['verify'], 'verified');
        return { ok: true, purpose: 'verify', email: used.email };
      }
      const [[before]] = await db.execute<RowDataPacket[]>('SELECT email FROM users WHERE id = ?', [used.userId]);
      try {
        const [result] = await db.execute<ResultSetHeader>(
          'UPDATE users SET email = ?, google_id = NULL, email_verified_at = UTC_TIMESTAMP() WHERE id = ? AND deleted_at IS NULL',
          [used.email, used.userId],
        );
        if (result.affectedRows === 0) return reply.code(400).send({ error: 'link_invalid' });
        await recordAccountChange(db, used.userId, 'email', (before?.email as string | undefined) ?? null, used.email, 'email_link');
      } catch (err) {
        if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return reply.code(409).send({ error: 'email_in_use' });
        throw err;
      }
      // Links sent to the old address (a new password, confirming it) and any other new address stop working.
      await revokeEmailTokens(db, used.userId, ['reset', 'verify', 'change'], 'address_changed');
      return { ok: true, purpose: 'change', email: used.email };
    },
  );
};

/** A blocked account's attempt, as the sign-in history names it. */
const blockOutcome = (block: AccountBlock): SignInOutcome => (block.error === 'account_deleted' ? 'deleted' : 'suspended');

/** A link that doesn't work, as the answer says it: why, and (when it stopped before being used) what stopped it. */
function linkProblem(link: Extract<LinkResult, { ok: false }>) {
  return { error: link.error, ...(link.reason ? { reason: link.reason } : {}) };
}

export default authRoutes;
