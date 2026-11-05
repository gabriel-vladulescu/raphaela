import crypto from 'node:crypto';
import fs from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { injectPage } from '../server/src/seo/html';
import type { PageMeta } from '../server/src/seo/html';
import { site } from './src/config';

const api = 'http://127.0.0.1:3000';

/** The logo's version, as server/src/seo/brand.ts works it out: in the addresses of the images made from it. */
const brand = crypto.createHash('sha1').update(fs.readFileSync(new URL('../server/assets/logo.png', import.meta.url))).digest('hex').slice(0, 8);

/** Fills %SITE_NAME% and %BRAND% in index.html from site.config.ts and server/assets/logo.png, so they're set in one place. */
const siteName = (): Plugin => ({
  name: 'site-name',
  transformIndexHtml: (html) =>
    html.replaceAll('%SITE_NAME%', site.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;')).replaceAll('%BRAND%', brand),
});

/**
 * Gives each page its title, search engine and share tags, and the data it starts from, as the API server does in
 * production. Not the post's HTML: in development the CSS arrives with the JavaScript, so it would show unstyled
 * for a moment (in production the CSS is linked in <head>). If the API isn't up yet, the plain page is served.
 */
const pageTags = (): Plugin => ({
  name: 'page-tags',
  apply: 'serve',
  async transformIndexHtml(html, context) {
    if (!context.originalUrl) return html;
    try {
      const response = await fetch(`${api}/api/seo/page?path=${encodeURIComponent(context.originalUrl)}`);
      return response.ok ? injectPage(html, { ...((await response.json()) as PageMeta), root: '' }) : html;
    } catch {
      return html;
    }
  },
});

export default defineConfig({
  plugins: [react(), siteName(), pageTags()],
  resolve: { tsconfigPaths: true }, // "@/..." aliases from tsconfig.json
  server: {
    // Also on the local network (0.0.0.0), to open the app on a phone at http://<this computer's IP>:5173.
    // The API stays on localhost: the phone only talks to Vite, which forwards /api to it.
    host: true,
    port: 5173,
    strictPort: true, // APP_URL in server/.env points here
    // xfwd: the API sees each visitor's own IP (statistics), not Vite's.
    proxy: {
      '/api': { target: api, xfwd: true },
      '/uploads': api,
      '/icons': api,
      '/manifest.webmanifest': api,
      '/favicon.ico': api,
      '/robots.txt': api,
      '/sitemap.xml': api,
      '/rss.xml': api,
    },
  },
});
