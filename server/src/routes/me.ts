import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createEmailToken, deleteAccount, hasPosts, sendVerification } from '@/lib/accounts';
import { exportAccount } from '@/lib/dataExport';
import { changeEmail, langOf, siteLink } from '@/lib/emails';
import { requireUser } from '@/lib/guards';
import { canSendMail, sendMail } from '@/lib/mail';
import { importLikes, likedPostIds } from '@/lib/likes';
import { hashPassword, verifyPassword } from '@/lib/password';
import { VISIBLE_POST } from '@/lib/posts';
import { canClaimEmail, endOtherSessions, endSession, getGoogleLink, loadUser, roleOverrideFor, setGoogleLink } from '@/lib/session';
import { usernameProblemFor } from '@/lib/usernames';
import { keepVisitor } from '@/lib/visitor';
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
/** The language the page was in, for the email it makes the server send. */
const langSchema = { type: 'string', enum: ['ro', 'en'] } as const;
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
  // password sets one here; one with a password confirms with it. The new address gets a link, and becomes the
  // account's once it's followed (routes/auth.ts, /auth/verify-email); until then `pending` is it. Without a way to
  // send email (production without SMTP), it changes at once, unconfirmed. An address another account has (even a
  // deleted one, kept for a while) can't be taken; administrator addresses only through Google (canClaimEmail).
  app.put<{ Body: { email: string; currentPassword?: string; newPassword?: string; lang?: string } }>(
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
            lang: langSchema,
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.user!;
      const email = req.body.email.trim().toLowerCase();
      if (email === user.email) return { user, pending: null };
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
      const [used] = await db.execute<RowDataPacket[]>('SELECT id FROM users WHERE email = ? AND id <> ?', [email, user.id]);
      if (used[0]) return reply.code(409).send({ error: 'email_in_use' });

      if (canSendMail()) {
        if (newHash) await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, user.id]);
        const token = await createEmailToken(db, user.id, 'change', email);
        void sendMail(changeEmail(email, langOf(req.body.lang), user.name, siteLink(`/confirmare-email?token=${token}`)));
        return { user: await loadUser(db, user.id), pending: email };
      }
      try {
        await db.execute(
          'UPDATE users SET email = ?, email_verified_at = NULL, google_id = NULL, password_hash = COALESCE(?, password_hash) WHERE id = ?',
          [email, newHash, user.id],
        );
      } catch (err) {
        if (duplicateOf(err)) return reply.code(409).send({ error: 'email_in_use' });
        throw err;
      }
      return { user: await loadUser(db, user.id), pending: null };
    },
  );

  // Gives up a new address waiting for confirmation (its link stops working).
  app.delete('/me/email/pending', { preHandler: requireUser }, async (req) => {
    await db.execute("DELETE FROM email_tokens WHERE user_id = ? AND purpose = 'change'", [req.user!.id]);
    return { user: await loadUser(db, req.user!.id) };
  });

  // Sends the link that confirms the account's address again.
  app.post<{ Body: { lang?: string } }>(
    '/me/verify-email',
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 3, timeWindow: '10 minutes' } },
      schema: { body: { type: 'object', additionalProperties: false, properties: { lang: langSchema } } },
    },
    async (req, reply) => {
      const user = req.user!;
      if (user.emailVerified) return { ok: true };
      if (!canSendMail()) return reply.code(503).send({ error: 'email_unavailable' });
      if (!(await sendVerification(db, user, langOf(req.body?.lang)))) return reply.code(502).send({ error: 'email_failed' });
      return { ok: true };
    },
  );

  // Everything kept about the account, as a JSON file to download (Profile, "Descarcă datele mele").
  app.get('/me/export', { preHandler: requireUser, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const data = await exportAccount(db, req.user!.id);
    const day = new Date().toISOString().slice(0, 10);
    reply
      .type('application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="raphaela-${req.user!.username || 'cont'}-${day}.json"`)
      .header('Cache-Control', 'no-store');
    return JSON.stringify(data, null, 2);
  });

  // What deleting the account will ask: whether they have posts (then they choose what happens to them).
  app.get('/me/deletion', { preHandler: requireUser }, async (req) => ({ hasPosts: await hasPosts(db, req.user!.id) }));

  // Deletes the account (after a confirmation dialog; with the password when it has one), as they chose: their
  // comments (with the replies under them) and an author's posts kept or deleted. It's signed out and kept at least
  // 3 months (it can be restored through support), then an administrator deletes it for good (lib/accounts.ts).
  // Administrators can't.
  app.delete<{ Body: { password?: string; lang?: string; comments: 'keep' | 'delete'; posts?: 'keep' | 'delete' } }>(
    '/me',
    {
      preHandler: requireUser,
      config: accountRateLimit,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['comments'],
          properties: {
            password: { type: 'string', maxLength: 200 },
            lang: langSchema,
            comments: { type: 'string', enum: ['keep', 'delete'] },
            posts: { type: 'string', enum: ['keep', 'delete'] },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.user!;
      if (user.role === 'owner') return reply.code(403).send({ error: 'owner_cannot_delete' });
      const withPosts = await hasPosts(db, user.id);
      if (withPosts && !req.body.posts) return reply.code(400).send({ error: 'posts_choice_required' });
      const [[row]] = await db.execute<RowDataPacket[]>('SELECT password_hash FROM users WHERE id = ?', [user.id]);
      if (row!.password_hash && !(req.body?.password && (await verifyPassword(req.body.password, row!.password_hash as string)))) {
        return reply.code(400).send({ error: 'wrong_password' });
      }
      const purgeOn = await deleteAccount(db, user.id, langOf(req.body.lang), {
        comments: req.body.comments,
        posts: withPosts ? req.body.posts! : null,
      });
      await endSession(db, req, reply);
      return { ok: true, purgeOn };
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
      await db.execute(
        `UPDATE users SET google_id = ?, email = ?, email_verified_at = UTC_TIMESTAMP(), picture = COALESCE(?, picture),
                role = COALESCE(?, role)
          WHERE id = ?`,
        [link.sub, link.email, link.picture, roleOverrideFor(link.email), user.id],
      );
      // A new address waiting for its link is dropped: this one, proven by Google, replaced it.
      await db.execute("DELETE FROM email_tokens WHERE user_id = ? AND purpose IN ('change', 'verify')", [user.id]);
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
    // At least 256 × 256, as the profile page asks (it explains it before uploading).
    const saved = await saveImage(file, { prefix: AVATAR_PREFIX, maxSide: 512, minSide: 256 });
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
    async (req, reply) => {
      if (!req.visitor.bot && req.body.likes.length) {
        keepVisitor(req, reply);
        await importLikes(db, req, req.body.likes);
      }
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
