import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { requireUser } from '@/lib/guards';
import { importLikes, likedPostIds } from '@/lib/likes';
import { hashPassword, verifyPassword } from '@/lib/password';
import { VISIBLE_POST } from '@/lib/posts';
import { canClaimEmail, endOtherSessions, getGoogleLink, loadUser, roleOverrideFor, setGoogleLink } from '@/lib/session';
import { usernameProblemFor } from '@/lib/usernames';
import { removeUpload, saveImage } from '@/lib/uploads';

const AVATAR_PREFIX = 'avatar-';

/** The viewer's liked posts (account, or this browser for guests) and, with an account, saved posts. */
async function getReactions(db: Pool, req: FastifyRequest) {
  // Administrators don't save posts.
  const [bookmarks] = req.user && req.user.role !== 'owner'
    ? await db.execute<RowDataPacket[]>('SELECT post_id FROM post_bookmarks WHERE user_id = ? ORDER BY created_at DESC', [req.user.id])
    : [[] as RowDataPacket[]];
  return {
    likes: await likedPostIds(db, req),
    bookmarks: bookmarks.map((row) => row.post_id as number),
  };
}

const idList = { type: 'array', maxItems: 500, items: { type: 'integer', minimum: 1 } } as const;

const newPasswordSchema = { type: 'string', minLength: 8, maxLength: 200 } as const;
/** Changing how an account signs in: a few tries a minute (they check the current password). */
const accountRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

/** A unique index refused it: whose? (users.email, or users.google_id) */
const duplicateOf = (err: unknown) => {
  const { code, message } = err as { code?: string; message?: string };
  if (code !== 'ER_DUP_ENTRY') return null;
  return message?.includes('google_id') ? 'google_taken' : 'email_in_use';
};

const meRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get('/me', async (req) => ({ user: req.user }));

  // Profile settings. Also confirms the name picked after the first Google sign-in (which sends only the name,
  // with the agreement to the Terms when the account was made without it, i.e. not from the register page).
  app.patch<{ Body: { name: string; username?: string; occupation?: string; quote?: string; acceptTerms?: boolean } }>(
    '/me',
    {
      preHandler: requireUser,
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', maxLength: 80 },
            username: { type: 'string', maxLength: 40 },
            occupation: { type: 'string', maxLength: 80 },
            quote: { type: 'string', maxLength: 300 },
            acceptTerms: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const { id: userId, nameConfirmed, termsAccepted } = req.user!;
      const name = req.body.name.trim();
      if (name.length < 2) return reply.code(400).send({ error: 'name_invalid' });
      if (!nameConfirmed && !termsAccepted && req.body.acceptTerms !== true) return reply.code(400).send({ error: 'terms_required' });
      // A new username: valid, not one of the site's words, and free.
      const username = req.body.username?.trim().toLowerCase();
      if (username !== undefined && username !== req.user!.username) {
        const problem = await usernameProblemFor(db, username, userId);
        if (problem) return reply.code(problem === 'username_taken' ? 409 : 400).send({ error: problem });
        try {
          await db.execute('UPDATE users SET username = ? WHERE id = ?', [username, userId]);
        } catch (err) {
          if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return reply.code(409).send({ error: 'username_taken' });
          throw err;
        }
      }
      await db.execute('UPDATE users SET name = ?, name_confirmed = 1 WHERE id = ?', [name, userId]);
      if (req.body.acceptTerms === true) {
        await db.execute('UPDATE users SET terms_accepted_at = COALESCE(terms_accepted_at, UTC_TIMESTAMP()) WHERE id = ?', [userId]);
      }
      // Left out = unchanged; empty = cleared.
      for (const field of ['occupation', 'quote'] as const) {
        const value = req.body[field];
        if (value !== undefined) await db.execute(`UPDATE users SET ${field} = ? WHERE id = ?`, [value.trim() || null, userId]);
      }
      return { user: await loadUser(db, userId) };
    },
  );

  // Whether a username is free for this account: the profile page asks a moment after it's typed.
  app.get<{ Querystring: { value?: string } }>(
    '/me/username-check',
    { preHandler: requireUser, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      const value = String(req.query.value ?? '').trim().toLowerCase().slice(0, 64);
      if (value === req.user!.username) return { value, status: 'current' };
      return { value, status: (await usernameProblemFor(db, value, req.user!.id)) ?? 'available' };
    },
  );

  // A new email. It stops signing in with Google (whose address is always the account's), so an account without a
  // password sets one here; one with a password confirms with it. It isn't checked by email: there's no email
  // service yet. Administrator addresses only through Google (canClaimEmail).
  app.put<{ Body: { email: string; currentPassword?: string; newPassword?: string } }>(
    '/me/email',
    {
      preHandler: requireUser,
      config: accountRateLimit,
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 255 },
            currentPassword: { type: 'string', maxLength: 200 },
            newPassword: newPasswordSchema,
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.user!;
      const email = req.body.email.trim().toLowerCase();
      if (email === user.email) return { user };
      const [[row]] = await db.execute<RowDataPacket[]>('SELECT password_hash FROM users WHERE id = ?', [user.id]);
      let newHash: string | null = null;
      if (row!.password_hash) {
        if (!req.body.currentPassword || !(await verifyPassword(req.body.currentPassword, row!.password_hash as string))) {
          return reply.code(400).send({ error: 'wrong_password' });
        }
      } else {
        if (!req.body.newPassword) return reply.code(400).send({ error: 'password_required' });
        newHash = await hashPassword(req.body.newPassword);
      }
      if (!canClaimEmail(email, user.role)) return reply.code(400).send({ error: 'email_google_only' });
      try {
        await db.execute('UPDATE users SET email = ?, google_id = NULL, password_hash = COALESCE(?, password_hash) WHERE id = ?', [
          email,
          newHash,
          user.id,
        ]);
      } catch (err) {
        if (duplicateOf(err)) return reply.code(409).send({ error: 'email_in_use' });
        throw err;
      }
      return { user: await loadUser(db, user.id) };
    },
  );

  // Sets a password (accounts made with Google have none) or changes it (with the current one). The account's
  // other browsers are signed out.
  app.put<{ Body: { currentPassword?: string; newPassword: string } }>(
    '/me/password',
    {
      preHandler: requireUser,
      config: accountRateLimit,
      schema: {
        body: {
          type: 'object',
          required: ['newPassword'],
          additionalProperties: false,
          properties: { currentPassword: { type: 'string', maxLength: 200 }, newPassword: newPasswordSchema },
        },
      },
    },
    async (req, reply) => {
      const user = req.user!;
      const [[row]] = await db.execute<RowDataPacket[]>('SELECT password_hash FROM users WHERE id = ?', [user.id]);
      if (row!.password_hash && !(req.body.currentPassword && (await verifyPassword(req.body.currentPassword, row!.password_hash as string)))) {
        return reply.code(400).send({ error: 'wrong_password' });
      }
      await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(req.body.newPassword), user.id]);
      await endOtherSessions(db, req, user.id);
      return { user: await loadUser(db, user.id) };
    },
  );

  // Stops signing in with Google. Without a password, one is set at the same time (else there'd be no way in).
  app.post<{ Body: { newPassword?: string } }>(
    '/me/google/unlink',
    {
      preHandler: requireUser,
      config: accountRateLimit,
      schema: { body: { type: 'object', additionalProperties: false, properties: { newPassword: newPasswordSchema } } },
    },
    async (req, reply) => {
      const user = req.user!;
      const [[row]] = await db.execute<RowDataPacket[]>('SELECT password_hash FROM users WHERE id = ?', [user.id]);
      if (!row!.password_hash && !req.body.newPassword) return reply.code(400).send({ error: 'password_required' });
      const newHash = row!.password_hash ? null : await hashPassword(req.body.newPassword!);
      await db.execute('UPDATE users SET google_id = NULL, password_hash = COALESCE(?, password_hash) WHERE id = ?', [newHash, user.id]);
      return { user: await loadUser(db, user.id) };
    },
  );

  // The Google account picked on the profile page ("Conectează Google", routes/auth.ts), when its address isn't
  // the account's: shown to be confirmed, since connecting it changes the email.
  app.get('/me/google/pending', { preHandler: requireUser }, async (req) => {
    const link = await getGoogleLink(db, req);
    return { pending: link ? { email: link.email, name: link.name, picture: link.picture } : null };
  });

  // Connects it: the email becomes its address, and a Google account connected before is replaced.
  app.post('/me/google/confirm', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const link = await getGoogleLink(db, req);
    if (!link) return reply.code(400).send({ error: 'link_expired' });
    await setGoogleLink(db, req, null);
    try {
      await db.execute('UPDATE users SET google_id = ?, email = ?, picture = COALESCE(?, picture), role = COALESCE(?, role) WHERE id = ?', [
        link.sub,
        link.email,
        link.picture,
        roleOverrideFor(link.email),
        user.id,
      ]);
    } catch (err) {
      const duplicate = duplicateOf(err);
      if (duplicate) return reply.code(409).send({ error: duplicate });
      throw err;
    }
    return { user: await loadUser(db, user.id) };
  });

  app.delete('/me/google/pending', { preHandler: requireUser }, async (req) => {
    await setGoogleLink(db, req, null);
    return { ok: true };
  });

  // Whether anyone may see their articles (/{username}/articole) and their saved ones (/{username}/articole-salvate).
  app.put<{ Body: { publicArticles?: boolean; publicSaved?: boolean } }>(
    '/me/privacy',
    {
      preHandler: requireUser,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { publicArticles: { type: 'boolean' }, publicSaved: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => {
      const { publicArticles, publicSaved } = req.body;
      // Administrators have no saved list (and their articles list is every post).
      if (req.user!.role === 'owner') return reply.code(403).send({ error: 'forbidden' });
      if (publicArticles !== undefined) await db.execute('UPDATE users SET public_articles = ? WHERE id = ?', [publicArticles ? 1 : 0, req.user!.id]);
      if (publicSaved !== undefined) await db.execute('UPDATE users SET public_saved = ? WHERE id = ?', [publicSaved ? 1 : 0, req.user!.id]);
      return { user: await loadUser(db, req.user!.id) };
    },
  );

  // A profile picture, used instead of the Google one. The browser frames it (a square, shown round) before uploading.
  app.post('/me/avatar', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 2 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: 'file_missing' });
    const saved = await saveImage(file, { prefix: AVATAR_PREFIX, maxSide: 512 });
    if ('error' in saved) return reply.code(400).send(saved);
    const userId = req.user!.id;
    const [[previous]] = await db.execute<RowDataPacket[]>('SELECT avatar_url FROM users WHERE id = ?', [userId]);
    await db.execute('UPDATE users SET avatar_url = ? WHERE id = ?', [saved.url, userId]);
    await removeUpload(previous?.avatar_url ?? null, AVATAR_PREFIX);
    return { user: await loadUser(db, userId) };
  });

  // Back to the Google picture (or initials).
  app.delete('/me/avatar', { preHandler: requireUser }, async (req) => {
    const userId = req.user!.id;
    const [[previous]] = await db.execute<RowDataPacket[]>('SELECT avatar_url FROM users WHERE id = ?', [userId]);
    await db.execute('UPDATE users SET avatar_url = NULL WHERE id = ?', [userId]);
    await removeUpload(previous?.avatar_url ?? null, AVATAR_PREFIX);
    return { user: await loadUser(db, userId) };
  });

  // Everyone's likes are on the server; guests keep their saved posts in the browser (bookmarks stays empty).
  app.get('/reactions', async (req) => getReactions(db, req));

  // Likes a guest's browser kept locally before likes were stored on the server.
  app.post<{ Body: { likes: number[] } }>(
    '/likes/import',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: { type: 'object', required: ['likes'], additionalProperties: false, properties: { likes: idList } } },
    },
    async (req) => {
      if (!req.visitor.bot) await importLikes(db, req, req.body.likes);
      return getReactions(db, req);
    },
  );

  // Moves likes/bookmarks a guest saved in their browser into their account after signing in.
  app.post<{ Body: { likes: number[]; bookmarks: number[] } }>(
    '/me/reactions/import',
    {
      preHandler: requireUser,
      schema: {
        body: {
          type: 'object',
          required: ['likes', 'bookmarks'],
          additionalProperties: false,
          properties: { likes: idList, bookmarks: idList },
        },
      },
    },
    async (req) => {
      await importLikes(db, req, req.body.likes);
      if (req.body.bookmarks.length && req.user!.role !== 'owner') {
        await db.query(
          `INSERT IGNORE INTO post_bookmarks (user_id, post_id)
           SELECT ?, p.id FROM posts p WHERE p.id IN (?) AND ${VISIBLE_POST}`,
          [req.user!.id, req.body.bookmarks],
        );
      }
      return getReactions(db, req);
    },
  );
};

export default meRoutes;
