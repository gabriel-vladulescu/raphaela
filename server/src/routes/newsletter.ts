import type { FastifyPluginAsync } from 'fastify';
import { langOf } from '@/lib/emails';
import { requireUser } from '@/lib/guards';
import { mailConfigured } from '@/lib/mail';
import { confirmSubscription, dropBook, findSubscription, followableBook, setAllPosts, subscribe, unsubscribe } from '@/lib/newsletter';
import { siteSettings } from '@/lib/siteSettings';

const TOKEN = '^[A-Za-z0-9_-]{43}$';

type Found = NonNullable<Awaited<ReturnType<typeof findSubscription>>>;
/** What a subscription's pages show: the address, every new post or not, its books, and whether it's on. */
const shown = (found: Found) => ({
  email: found.email,
  allPosts: found.allPosts,
  books: found.books,
  active: found.active,
  confirmed: found.confirmed,
});

/**
 * The newsletter (lib/newsletter.ts): subscribing (to every new post, or to a book's chapters), confirming, and
 * changing or stopping it by the link in its emails (or from Settings).
 */
const newsletterRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.post<{ Body: { email: string; bookId?: number; lang?: string } }>(
    '/newsletter/subscribe',
    {
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 255 },
            bookId: { type: 'integer', minimum: 1 },
            lang: { type: 'string', enum: ['ro', 'en'] },
          },
        },
      },
    },
    async (req, reply) => {
      if (!siteSettings().newsletterEnabled) return reply.code(404).send({ error: 'not_found' });
      if (!mailConfigured()) return reply.code(503).send({ error: 'email_unavailable' });
      const book = req.body.bookId ? await followableBook(db, req.body.bookId) : null;
      if (req.body.bookId && !book) return reply.code(404).send({ error: 'not_found' });
      const status = await subscribe(db, { email: req.body.email, book, lang: langOf(req.body.lang), user: req.user });
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

  // The page an email's "change or unsubscribe" link opens: what the address gets, changing it, stopping it.
  app.get<{ Params: { token: string } }>('/newsletter/manage/:token', async (req, reply) => {
    const found = await findSubscription(db, { token: req.params.token });
    if (!found) return reply.code(404).send({ error: 'not_found' });
    return { subscription: shown(found) };
  });

  // Every new post, on or off (on again: a stopped subscription starts again).
  app.put<{ Params: { token: string }; Body: { allPosts: boolean } }>(
    '/newsletter/manage/:token',
    { schema: { body: { type: 'object', required: ['allPosts'], additionalProperties: false, properties: { allPosts: { type: 'boolean' } } } } },
    async (req, reply) => {
      const found = await findSubscription(db, { token: req.params.token });
      if (!found) return reply.code(404).send({ error: 'not_found' });
      await setAllPosts(db, found.id, req.body.allPosts);
      return { subscription: shown((await findSubscription(db, { token: req.params.token }))!) };
    },
  );

  // No more emails about a book's chapters.
  app.delete<{ Params: { token: string; bookId: number } }>(
    '/newsletter/manage/:token/books/:bookId',
    { schema: { params: { type: 'object', properties: { token: { type: 'string' }, bookId: { type: 'integer', minimum: 1 } } } } },
    async (req, reply) => {
      const found = await findSubscription(db, { token: req.params.token });
      if (!found) return reply.code(404).send({ error: 'not_found' });
      await dropBook(db, found.id, req.params.bookId);
      return { subscription: shown((await findSubscription(db, { token: req.params.token }))!) };
    },
  );

  // Unsubscribing: the manage page's button, and mail apps' one-click (RFC 8058 posts "List-Unsubscribe=One-Click").
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 1024 }, (_req, body, done) => done(null, body));
  app.post<{ Params: { token: string } }>('/newsletter/unsubscribe/:token', async (req, reply) => {
    if (!(await unsubscribe(db, req.params.token))) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // The signed-in person's own subscription (their account's address), for Settings and "Notify me".
  app.get('/me/newsletter', { preHandler: requireUser }, async (req) => {
    const found = await findSubscription(db, { email: req.user!.email });
    return { subscription: found ? { ...shown(found), token: found.token } : null };
  });
};

export default newsletterRoutes;
