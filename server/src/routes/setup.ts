import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { hashPassword } from '@/lib/password';
import { startSession } from '@/lib/session';
import { checkSetupCode, finishSetup, setupNeeded } from '@/lib/setup';
import { saveSiteIdentity, site } from '@/lib/siteIdentity';
import { assignUsername } from '@/lib/usernames';

/** The first run's setup (lib/setup.ts): the site's name and its first administrator, once. */
const setupRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get('/setup', async () => ({ needed: setupNeeded() }));

  app.post<{
    Body: {
      code: string;
      identity: { name: string; description: string; company: string; defaultLanguage: 'ro' | 'en' };
      admin: { name: string; email: string; password: string };
    };
  }>(
    '/setup',
    {
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['code', 'identity', 'admin'],
          additionalProperties: false,
          properties: {
            code: { type: 'string', maxLength: 20 },
            identity: {
              type: 'object',
              required: ['name', 'description', 'company', 'defaultLanguage'],
              additionalProperties: false,
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 60 },
                description: { type: 'string', maxLength: 300 },
                company: { type: 'string', maxLength: 80 },
                defaultLanguage: { type: 'string', enum: ['ro', 'en'] },
              },
            },
            admin: {
              type: 'object',
              required: ['name', 'email', 'password'],
              additionalProperties: false,
              properties: {
                name: { type: 'string', minLength: 2, maxLength: 80 },
                email: { type: 'string', format: 'email', maxLength: 255 },
                password: { type: 'string', minLength: 8, maxLength: 200 },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      if (!setupNeeded()) return reply.code(409).send({ error: 'setup_done' });
      if (!checkSetupCode(req.body.code)) return reply.code(403).send({ error: 'setup_code' });
      const { identity, admin } = req.body;
      const email = admin.email.trim().toLowerCase();
      const [taken] = await db.execute<RowDataPacket[]>('SELECT id FROM users WHERE email = ?', [email]);
      let userId: number;
      if (taken[0]) {
        userId = taken[0].id as number;
        await db.execute("UPDATE users SET role = 'owner', password_hash = ?, email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = ?", [
          await hashPassword(admin.password),
          userId,
        ]);
      } else {
        const [result] = await db.execute<ResultSetHeader>(
          `INSERT INTO users (email, email_verified_at, password_hash, name, name_confirmed, role, terms_accepted_at)
           VALUES (?, UTC_TIMESTAMP(), ?, ?, 1, 'owner', UTC_TIMESTAMP())`,
          [email, await hashPassword(admin.password), admin.name.trim()],
        );
        userId = result.insertId;
        await assignUsername(db, userId, admin.name.trim());
      }
      await saveSiteIdentity(db, {
        ...site,
        name: identity.name.trim(),
        description: identity.description.trim(),
        company: identity.company.trim() || identity.name.trim(),
        defaultLanguage: identity.defaultLanguage,
      });
      await finishSetup(db);
      await startSession(db, reply, userId);
      return { ok: true };
    },
  );
};

export default setupRoutes;
