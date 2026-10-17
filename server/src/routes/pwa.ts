import fs from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { site } from '../../../site.config';
import { BRAND_VERSION, NIGHT } from '@/seo/brand';
import { appIcon, splashLogo } from '@/seo/og';

/** The images made from the logo, by file name: the home-screen icons the manifest and index.html point to, the
 *  favicon, the splash's logo, and the notification badge. Each resolves to a cached file. */
const IMAGES: Record<string, { type: string; file: () => Promise<string> }> = {
  'icon-192.png': { type: 'image/png', file: () => appIcon(192, false) },
  'icon-512.png': { type: 'image/png', file: () => appIcon(512, false) },
  'maskable-512.png': { type: 'image/png', file: () => appIcon(512, true) },
  'apple-touch-icon.png': { type: 'image/png', file: () => appIcon(180, true) },
  'favicon-64.png': { type: 'image/png', file: () => appIcon(64, false) },
  'logo-480.webp': { type: 'image/webp', file: () => splashLogo(480) },
  // The small one-colour icon of push notifications (public/sw.js).
  'badge-96.png': { type: 'image/png', file: () => appIcon(96, 'badge') },
};

/** Icon addresses carry the logo's version, so a new logo reaches browsers and installed apps. */
const icon = (file: string) => `/icons/${file}?v=${BRAND_VERSION}`;

/**
 * What makes the site installable (an app on the home screen): the web app manifest and its icons, at the root
 * (Vite proxies them here in development). The service worker is a static file (client/public/sw.js).
 */
const pwaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/manifest.webmanifest', async (_req, reply) => {
    reply.type('application/manifest+json').header('Cache-Control', 'public, max-age=3600');
    return {
      name: site.name,
      short_name: site.name,
      description: site.description,
      lang: site.language,
      dir: 'ltr',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      // The midnight theme (the default): the app's launch screen and status bar.
      background_color: NIGHT,
      theme_color: NIGHT,
      categories: ['lifestyle', 'education', 'news'],
      icons: [
        { src: icon('icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: icon('icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: icon('maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
  });

  app.get<{ Params: { file: string } }>('/icons/:file', async (req, reply) => {
    const image = IMAGES[req.params.file];
    if (!image) return reply.code(404).send({ error: 'not_found' });
    reply.type(image.type).header('Cache-Control', 'public, max-age=86400');
    return reply.send(fs.createReadStream(await image.file()));
  });
};

export default pwaRoutes;
