import type { FastifyPluginAsync } from 'fastify';
import { countAuthors } from '@/lib/follows';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { findInvite } from '@/lib/invites';
import { hashPassword } from '@/lib/password';
import { logSignIn } from '@/lib/authLog';
import { startSession } from '@/lib/session';
import { assignUsername } from '@/lib/usernames';

const TOKEN = { type: 'string', minLength: 20, maxLength: 100 } as const;

/**
 * An invitation's link (/invitatie?token=…, lib/invites.ts): who invites whom, and accepting it. Signed in with the
 * invited address, the account becomes an author's; with no account yet, one is made (an author's, its address
 * confirmed by the link). Someone else signed in, or an existing account signed out, signs in with the invited
 * address first.
 */
const inviteRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get<{ Querystring: { token?: string } }>('/invites', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const invite = await findInvite(db, String(req.query.token ?? '').slice(0, 100));
    if (!invite) return reply.code(404).send({ error: 'link_invalid' });
    const [accounts] = await db.execute<RowDataPacket[]>('SELECT role FROM users WHERE email = ? AND purged_at IS NULL', [invite.email]);
    return {
      invite: {
        email: invite.email,
        inviter: invite.inviter,
        message: invite.message,
        accountExists: accounts.length > 0,
        alreadyAuthor: accounts[0] ? accounts[0].role !== 'member' : false,
        signedInAs: req.user ? req.user.email : null,
      },
    };
  });

  app.post<{ Body: { token: string; name?: string; password?: string; acceptTerms?: boolean } }>(
    '/invites/accept',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          additionalProperties: false,
          properties: {
            token: TOKEN,
            name: { type: 'string', maxLength: 80 },
            password: { type: 'string', minLength: 8, maxLength: 200 },
            acceptTerms: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const invite = await findInvite(db, req.body.token);
      if (!invite) return reply.code(400).send({ error: 'link_invalid' });
      const accept = async (userId: number) => {
        await db.execute('UPDATE invites SET accepted_at = UTC_TIMESTAMP(), accepted_user_id = ? WHERE id = ?', [userId, invite.id]);
      };

      // Signed in with the invited address: the account becomes an author's (an administrator stays one).
      if (req.user) {
        if (req.user.email !== invite.email) return reply.code(409).send({ error: 'invite_other_account', email: invite.email });
        await db.execute("UPDATE users SET role = 'author', email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = ? AND role = 'member'", [
          req.user.id,
        ]);
        await accept(req.user.id);
        void countAuthors(db);
        return { ok: true };
      }

      const [accounts] = await db.execute<RowDataPacket[]>('SELECT id FROM users WHERE email = ? AND purged_at IS NULL', [invite.email]);
      if (accounts[0]) return reply.code(409).send({ error: 'invite_sign_in', email: invite.email });

      const name = req.body.name?.trim() ?? '';
      if (name.length < 2) return reply.code(400).send({ error: 'name_invalid' });
      if (!req.body.password) return reply.code(400).send({ error: 'password_required' });
      if (req.body.acceptTerms !== true) return reply.code(400).send({ error: 'terms_required' });
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO users (email, email_verified_at, password_hash, name, name_confirmed, role, terms_accepted_at)
         VALUES (?, UTC_TIMESTAMP(), ?, ?, 1, 'author', UTC_TIMESTAMP())`,
        [invite.email, await hashPassword(req.body.password), name],
      );
      await assignUsername(db, result.insertId, name);
      await accept(result.insertId);
      await startSession(db, reply, result.insertId);
      await logSignIn(db, req, { userId: result.insertId, email: invite.email as string, method: 'invite', outcome: 'ok' });
      return { ok: true };
    },
  );
};

export default inviteRoutes;
