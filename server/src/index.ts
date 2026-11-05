import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from '@/config';
import { connectDb } from '@/db';
import '@/lib/guards'; // Fastify type augmentation (app.db, req.user)
import { accountHousekeeping } from '@/lib/accounts';
import { loadMailSettings } from '@/lib/mail';
import { newsletterTick } from '@/lib/newsletter';
import { initSetup } from '@/lib/setup';
import { loadSiteIdentity } from '@/lib/siteIdentity';
import { loadSiteSettings, siteSettings } from '@/lib/siteSettings';
import { getSessionUser } from '@/lib/session';
import { announceNewPosts } from '@/lib/notifications';
import { initPush } from '@/lib/push';
import { ensureUsernames } from '@/lib/usernames';
import { identify, loadVisitorSalt } from '@/lib/visitor';
import authRoutes from '@/routes/auth';
import categoryRoutes from '@/routes/categories';
import commentRoutes from '@/routes/comments';
import feedRoutes from '@/routes/feeds';
import meRoutes from '@/routes/me';
import adminRoutes from '@/routes/admin';
import adminContentRoutes from '@/routes/adminContent';
import followRoutes from '@/routes/follows';
import inviteRoutes from '@/routes/invites';
import newsletterRoutes from '@/routes/newsletter';
import setupRoutes from '@/routes/setup';
import notificationRoutes from '@/routes/notifications';
import peopleRoutes from '@/routes/people';
import postRoutes from '@/routes/posts';
import pushRoutes from '@/routes/push';
import pwaRoutes from '@/routes/pwa';
import seoRoutes from '@/routes/seo';
import seriesRoutes from '@/routes/series';
import settingsRoutes from '@/routes/settings';
import statsRoutes from '@/routes/stats';
import supportRoutes from '@/routes/support';
import trackRoutes from '@/routes/track';
import uploadRoutes from '@/routes/uploads';
import { injectPage } from '@/seo/html';
import { describePage } from '@/seo/page';

const app = Fastify({ logger: true, bodyLimit: 4 * 1024 * 1024, trustProxy: config.trustProxy });
const db = await connectDb(config.db);
await ensureUsernames(db); // accounts made before usernames existed
await loadVisitorSalt(db);
await initPush(db);
await loadMailSettings(db);
await loadSiteSettings(db);
await loadSiteIdentity(db);
await initSetup(db);
app.decorate('db', db);
app.decorateRequest('user', null);
app.decorateRequest('visitor', null as never);
app.addHook('onClose', async () => db.end());

// On every answer: no guessing types from content, no framing by other sites, and only the origin as referrer.
app.addHook('onSend', async (_req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'SAMEORIGIN');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});
await app.register(cookie);
await app.register(rateLimit, { global: false });
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }); // images are shrunk and converted on save

fs.mkdirSync(config.uploadsDir, { recursive: true });
await app.register(fastifyStatic, {
  root: config.uploadsDir,
  prefix: '/uploads/',
  setHeaders: (reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
  },
});

/** What stays open during maintenance (signing in, the session, what every page needs). */
const MAINTENANCE_OPEN = /^\/api\/(auth\/|me(\?|$)|site(\?|$)|seo\/page|setup|newsletter\/unsubscribe)/;

// API errors are `{ error: code }`; the client translates the codes.
app.setErrorHandler<FastifyError>((err, req, reply) => {
  if (err.validation) return reply.code(400).send({ error: 'invalid_input', message: err.message });
  const status = err.statusCode ?? 500;
  if (status >= 500) {
    req.log.error(err);
    return reply.code(500).send({ error: 'server_error' });
  }
  const code = status === 429 ? 'rate_limited' : status === 413 ? 'file_too_large' : 'request_failed';
  return reply.code(status).send({ error: code, message: err.message });
});

await app.register(
  async (api) => {
    api.addHook('onRequest', async (req, reply) => {
      req.user = await getSessionUser(db, req);
      req.visitor = identify(req, reply);
      // Maintenance: only administrators use the site; others can still sign in (an administrator has to) and
      // learn that it's closed.
      if (siteSettings().maintenance && req.user?.role !== 'owner' && !MAINTENANCE_OPEN.test(req.url)) {
        return reply.code(503).header('Retry-After', '3600').send({ error: 'maintenance' });
      }
    });
    for (const routes of [authRoutes, meRoutes, postRoutes, categoryRoutes, commentRoutes, uploadRoutes, seoRoutes, trackRoutes, statsRoutes, notificationRoutes, pushRoutes, seriesRoutes, settingsRoutes, supportRoutes, peopleRoutes, adminRoutes, adminContentRoutes, followRoutes, inviteRoutes, newsletterRoutes, setupRoutes]) {
      await api.register(routes);
    }
  },
  { prefix: '/api' },
);

// robots.txt, sitemap.xml, rss.xml, and the web app manifest and icons (Vite proxies them here in development).
await app.register(feedRoutes);
await app.register(pwaRoutes);

// Production: the built app's files, and every page as index.html with that page's title, tags and (for posts)
// content, and a 404 status for pages that don't exist. In development Vite does this (see client/vite.config.ts).
if (config.serveClient) {
  const template = fs.readFileSync(path.join(config.clientDist, 'index.html'), 'utf8');
  await app.register(fastifyStatic, {
    root: config.clientDist,
    prefix: '/',
    index: false,
    wildcard: false,
    decorateReply: false,
    setHeaders: (reply, file) => {
      // Built assets have a content hash in their names.
      if (file.includes(`${path.sep}assets${path.sep}`)) reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    },
  });
  app.get('/*', async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/')) return reply.code(404).send({ error: 'not_found' });
    const page = await describePage(db, req.url, await getSessionUser(db, req));
    if (page.redirect) return reply.redirect(page.redirect, page.status === 302 ? 302 : 301);
    if (page.status === 503) reply.header('Retry-After', '3600');
    return reply.code(page.status).type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(injectPage(template, page));
  });
}

// New posts are announced (push) once they're public; scheduled ones when their time comes.
void announceNewPosts(db);
const announcer = setInterval(() => void announceNewPosts(db), 60_000);
// Every minute: the newsletter's next emails (lib/newsletter.ts).
const newsletter = setInterval(() => void newsletterTick(db), 60_000);
app.addHook('onClose', async () => clearInterval(newsletter));

// Hourly: administrators hear about deleted accounts whose 3 months are up; old tickets and statistics go (lib/accounts.ts).
void accountHousekeeping(db);
const purger = setInterval(() => void accountHousekeeping(db), 60 * 60_000);
app.addHook('onClose', async () => {
  clearInterval(announcer);
  clearInterval(purger);
});

await app.listen({ port: config.port, host: config.host });
