import crypto from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import type { TokenPayload } from 'google-auth-library';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from '@/config';
import { burnPasswordCheck, hashPassword, verifyPassword } from '@/lib/password';
import { claimGuestLikes } from '@/lib/likes';
import { canClaimEmail, endSession, roleOverrideFor, setGoogleLink, startSession } from '@/lib/session';
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

/** `acceptedTerms`: a new account records when its owner agreed to the Terms (existing ones are left as they are). */
async function upsertGoogleUser(db: Pool, profile: TokenPayload & { email: string }, acceptedTerms: boolean): Promise<number> {
  const email = profile.email.toLowerCase();
  const role = roleOverrideFor(email);

  const [byGoogleId] = await db.execute<RowDataPacket[]>('SELECT id FROM users WHERE google_id = ?', [profile.sub]);
  const [byEmail] = byGoogleId[0]
    ? [[]]
    : await db.execute<RowDataPacket[]>('SELECT id FROM users WHERE email = ?', [email]);
  const existingId: number | undefined = byGoogleId[0]?.id ?? byEmail[0]?.id;

  if (existingId) {
    // Links Google to an email/password account with the same (Google-verified) email.
    await db.execute(
      `UPDATE users SET google_id = ?, picture = COALESCE(?, picture), role = COALESCE(?, role),
              last_login_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [profile.sub, profile.picture ?? null, role, existingId],
    );
    return existingId;
  }

  const name = (profile.name?.trim() || email.split('@')[0]).slice(0, 80);
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO users (google_id, email, name, picture, role, terms_accepted_at)
     VALUES (?, ?, ?, ?, ?, ${acceptedTerms ? 'UTC_TIMESTAMP()' : 'NULL'})`,
    [profile.sub, email, name, profile.picture ?? null, role ?? 'member'],
  );
  await assignUsername(db, result.insertId, name);
  return result.insertId;
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
    await db.execute('UPDATE users SET google_id = ?, picture = COALESCE(?, picture), role = COALESCE(?, role) WHERE id = ?', [
      profile.sub,
      profile.picture ?? null,
      roleOverrideFor(email),
      user.id,
    ]);
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
        const userId = await upsertGoogleUser(db, { ...profile, email: profile.email }, acceptedTerms);
        await startSession(db, reply, userId);
        await claimGuestLikes(db, userId, req.visitor.id); // likes given before signing in
        return reply.redirect(`${config.appUrl}${next}`);
      } catch (err) {
        req.log.error(err, 'Google sign-in failed');
        return reply.redirect(failRedirect);
      }
    },
  );

  // Signing up needs agreeing to the Terms and Conditions (the checkbox on the register page).
  app.post<{ Body: Credentials & { name: string; acceptTerms?: boolean } }>(
    '/auth/register',
    {
      config: authRateLimit,
      schema: {
        body: {
          type: 'object',
          required: ['name', 'email', 'password'],
          additionalProperties: false,
          properties: { name: { type: 'string', maxLength: 80 }, acceptTerms: { type: 'boolean' }, ...credentialProperties },
        },
      },
    },
    async (req, reply) => {
      const name = req.body.name.trim();
      const email = req.body.email.trim().toLowerCase();
      if (req.body.acceptTerms !== true) return reply.code(400).send({ error: 'terms_required' });
      if (name.length < 2) return reply.code(400).send({ error: 'name_invalid' });

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
      await claimGuestLikes(db, result.insertId, req.visitor.id); // likes given before signing in
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
      const [rows] = await db.execute<RowDataPacket[]>('SELECT id, password_hash FROM users WHERE email = ?', [email]);
      const user = rows[0];

      if (!user?.password_hash) {
        await burnPasswordCheck(req.body.password);
        return reply.code(401).send({ error: user ? 'use_google' : 'invalid_credentials' });
      }
      if (!(await verifyPassword(req.body.password, user.password_hash))) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }

      await db.execute(
        'UPDATE users SET role = COALESCE(?, role), last_login_at = CURRENT_TIMESTAMP WHERE id = ?',
        [roleOverrideFor(email), user.id],
      );
      await startSession(db, reply, user.id);
      await claimGuestLikes(db, user.id, req.visitor.id); // likes given before signing in
      return { ok: true };
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    await endSession(db, req, reply);
    return { ok: true };
  });
};

export default authRoutes;
