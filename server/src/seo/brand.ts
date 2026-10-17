import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The site's logo: logo.png at the root of the repo (a phoenix on a transparent background). The home-screen icons,
 * the favicon, the splash (client/index.html) and the share images are all made from it, so replacing that one file
 * changes them all.
 */
export const LOGO_FILE = path.resolve(import.meta.dirname, '../../../logo.png');
export const LOGO = fs.readFileSync(LOGO_FILE);

/** Changes with the logo. It's in the images' addresses, since browsers, the service worker and apps keep icons for
 *  long (client/vite.config.ts works out the same value for index.html). */
export const BRAND_VERSION = crypto.createHash('sha1').update(LOGO).digest('hex').slice(0, 8);

/** The midnight theme's sky, behind the logo where it needs a background (Android's and Apple's icons). */
export const NIGHT = '#050918';
