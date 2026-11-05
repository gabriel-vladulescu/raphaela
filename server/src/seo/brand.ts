import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '@/config';

/**
 * The site's logo: server/assets/logo.png (a phoenix on a transparent background), unless an administrator uploaded
 * another one (admin panel → Setări → Identitate; kept as uploads/brand-logo.png). The home-screen icons, the favicon,
 * the splash and the share images are all made from it, so changing it changes them all. `LOGO` and `BRAND_VERSION`
 * are live bindings: modules that import them see a new logo at once.
 */
export const LOGO_FILE = path.resolve(import.meta.dirname, '../../assets/logo.png');
const CUSTOM_LOGO = path.join(config.uploadsDir, 'brand-logo.png');

const versionOf = (image: Buffer) => crypto.createHash('sha1').update(image).digest('hex').slice(0, 8);

export let LOGO: Buffer = fs.readFileSync(fs.existsSync(CUSTOM_LOGO) ? CUSTOM_LOGO : LOGO_FILE);

/** Changes with the logo. It's in the images' addresses, since browsers, the service worker and apps keep icons for
 *  long (client/vite.config.ts works out the default logo's for index.html; the server puts the current one in). */
export let BRAND_VERSION = versionOf(LOGO);

export const customLogo = () => fs.existsSync(CUSTOM_LOGO);

/** A new logo (a PNG), or back to the default one (null). */
export async function setLogo(png: Buffer | null) {
  if (png) await fs.promises.writeFile(CUSTOM_LOGO, png);
  else await fs.promises.rm(CUSTOM_LOGO, { force: true });
  LOGO = png ?? fs.readFileSync(LOGO_FILE);
  BRAND_VERSION = versionOf(LOGO);
}

/** The midnight theme's sky, behind the logo where it needs a background (Android's and Apple's icons). */
export const NIGHT = '#050918';
