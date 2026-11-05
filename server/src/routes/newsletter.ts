import type { FastifyPluginAsync } from 'fastify';
import { langOf } from '@/lib/emails';
import { requireUser } from '@/lib/guards';
import { canSendMail } from '@/lib/mail';
import { confirmSubscription, findSubscription, subscribe, unsubscribe } from '@/lib/newsletter';
import { siteSettings } from '@/lib/siteSettings';

const TOKEN = '^[A-Za-z0-9_-]{43}$';
const frequency = { type: 'string', enum: ['instant', 'weekly'] } as const;

/** The newsletter (lib/newsletter.ts): subscribing, confirming, changing or stopping it by the link in its emails. */
const newsletterRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.post<{ Body: { email: string; frequency: 'instant' | 'weekly'; lang?: string } }>(
    '/newsletter/subscribe',
    {
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['email', 'frequency'],
          additionalProperties: false,
          properties: { email: { type: 'string', format: 'email', maxLength: 255 }, frequency, lang: { type: 'string', enum: ['ro', 'en'] } },
        },
      },
    },
    async (req, reply) => {
      if (!siteSettings().newsletterEnabled) return reply.code(404).send({ error: 'not_found' });
      if (!canSendMail()) return reply.code(503).send({ error: 'email_unavailable' });
      const status = await subscribe(db, { email: req.body.email, frequency: req.body.frequency, lang: langOf(req.body.lang), user: req.user });
      return { status };
    },
  );

  app.post<{ Body: { token: string } }>(
    '/newsletter/confirm',
    { schema: { body: { type: 'object', required: ['token'], additionalProperties: false, properties: { token: { type: 'string', pattern: TOKEN } } } } },
    async (req, reply) => {
      const email = await confirmSubscription(db, req.body.token);
      if (!email) return reply.code(400).send({ error: 'link_invalid' });
      return { email };
    },
  );

  // The page an email's "change or unsubscribe" link opens: the subscription, its frequency, stopping it.
  app.get<{ Params: { token: string } }>('/newsletter/manage/:token', async (req, reply) => {
    const found = await findSubscription(db, { token: req.params.token });
    if (!found) return reply.code(404).send({ error: 'not_found' });
    return { subscription: { email: found.email, frequency: found.frequency, active: found.active, confirmed: found.confirmed } };
  });

  app.put<{ Params: { token: string }; Body: { frequency: 'instant' | 'weekly' } }>(
    '/newsletter/manage/:token',
    { schema: { body: { type: 'object', required: ['frequency'], additionalProperties: false, properties: { frequency } } } },
    async (req, reply) => {
      const found = await findSubscription(db, { token: req.params.token });
      if (!found) return reply.code(404).send({ error: 'not_found' });
      await db.execute('UPDATE newsletter_subscribers SET frequency = ?, unsubscribed_at = NULL WHERE id = ?', [req.body.frequency, found.id]);
      return { ok: true };
    },
  );

  // Unsubscribing: the manage page's button, and mail apps' one-click (RFC 8058 posts "List-Unsubscribe=One-Click").
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 1024 }, (_req, body, done) => done(null, body));
  app.post<{ Params: { token: string } }>('/newsletter/unsubscribe/:token', async (req, reply) => {
    if (!(await unsubscribe(db, req.params.token))) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // The signed-in person's own subscription (their account's address), for the Settings page.
  app.get('/me/newsletter', { preHandler: requireUser }, async (req) => {
    const found = await findSubscription(db, { email: req.user!.email });
    return { subscription: found ? { frequency: found.frequency, active: found.active, confirmed: found.confirmed, token: found.token } : null };
  });
};

export default newsletterRoutes;
