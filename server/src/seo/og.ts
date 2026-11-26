import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import opentype from 'opentype.js';
import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';
import { site } from '@/lib/siteIdentity';
import { config } from '@/config';
import { BRAND_VERSION, LOGO, NIGHT } from '@/seo/brand';

// Share images ("og:image"): what WhatsApp, Facebook, X and the rest show for a link. 1200 x 630 is the size they all
// use. Each post gets its banner with the title and category over it, like the top of the post page.
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/** Bump when the design below changes, so cached images and the platforms' copies are replaced. (The site's name
 *  and logo are in the images' versions too.) */
const DESIGN = 3;
const MARGIN = 64;
const TEXT_WIDTH = OG_WIDTH - MARGIN * 2;
const CACHE_DIR = path.join(config.uploadsDir, 'og');

// The site's fonts (SIL Open Font License, see assets/fonts). Text is drawn as glyph outlines from these files, so it
// looks the same on any server, whatever fonts it has installed.
const FONTS = path.resolve(import.meta.dirname, '../../assets/fonts');
function loadFont(file: string) {
  const data = fs.readFileSync(path.join(FONTS, file));
  return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}
const FRAUNCES = loadFont('Fraunces-SemiBold.ttf');
const INTER_SEMIBOLD = loadFont('Inter-SemiBold.ttf');
const INTER_BOLD = loadFont('Inter-Bold.ttf');

interface TextBlock {
  svg: Buffer;
  width: number;
  height: number;
  lines: number;
  /** From the block's top to the first line's baseline, and from there up to the top of the capitals. */
  ascent: number;
  capHeight: number;
}

/** Text as an SVG of glyph outlines, wrapped at word boundaries to `width`. */
function textBlock(text: string, font: opentype.Font, size: number, { color = '#ffffff', width = Infinity, lineHeight = 1.15 } = {}): TextBlock {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1);
    if (last !== undefined && font.getAdvanceWidth(`${last} ${word}`, size) <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const scale = size / font.unitsPerEm;
  const ascent = font.ascender * scale;
  const step = size * lineHeight;
  const paths = lines.map((line, index) => font.getPath(line, 0, ascent + index * step, size).toPathData(2)).join(' ');
  const blockWidth = Math.ceil(Math.max(1, ...lines.map((line) => font.getAdvanceWidth(line, size))));
  const blockHeight = Math.ceil(ascent + (lines.length - 1) * step - font.descender * scale);
  return {
    svg: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${blockWidth}" height="${blockHeight}"><path d="${paths}" fill="${color}"/></svg>`),
    width: blockWidth,
    height: blockHeight,
    lines: lines.length,
    ascent,
    capHeight: (font.tables.os2?.sCapHeight ?? font.ascender * 0.7) * scale,
  };
}

/** The title in up to three lines: smaller for long titles, and cut short (…) only if it still doesn't fit. */
function titleBlock(title: string) {
  const fit = (text: string, size: number) => textBlock(text, FRAUNCES, size, { width: TEXT_WIDTH, lineHeight: 1.1 });
  for (const size of [66, 60, 54, 48]) {
    const block = fit(title, size);
    if (block.lines <= 3) return block;
  }
  const words = title.split(/\s+/);
  while (words.length > 1) {
    words.pop();
    const block = fit(`${words.join(' ')}…`, 48);
    if (block.lines <= 3) return block;
  }
  return fit(title, 48);
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
/** The logo's PNGs with a 256-colour palette: alike to the eye, a quarter of the size (a 512px icon ~100 KB). */
const PNG = { palette: true, quality: 95, effort: 10, compressionLevel: 9 } as const;
let trimmed: { version: string; image: Promise<Buffer> } | null = null;
/** The logo without the empty margin around it (made again when the logo changes). */
function trimmedLogo() {
  if (trimmed?.version !== BRAND_VERSION) trimmed = { version: BRAND_VERSION, image: sharp(LOGO).trim().png().toBuffer() };
  return trimmed.image;
}

/** The logo fitted into a size x size square, transparent around it. */
async function logoPng(size: number) {
  return sharp(await trimmedLogo()).resize(size, size, { fit: 'contain', background: TRANSPARENT }).png(PNG).toBuffer();
}

/** The banner, cropped to fill the image; the site's dark gradient when there's none (or it can't be read). */
async function background(bannerUrl: string | null) {
  let source: Buffer | string | null = null;
  try {
    if (bannerUrl?.startsWith('/uploads/')) {
      const file = path.join(config.uploadsDir, path.basename(bannerUrl));
      if (fs.existsSync(file)) source = file;
    } else if (bannerUrl?.startsWith('https://')) {
      const response = await fetch(bannerUrl, { signal: AbortSignal.timeout(6000) });
      if (response.ok) source = Buffer.from(await response.arrayBuffer());
    }
    if (source) return await sharp(source, { density: 150 }).resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover' }).png().toBuffer();
  } catch {
    // fall back to the plain background below
  }
  return sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1236"/><stop offset="0.6" stop-color="#1b1150"/><stop offset="1" stop-color="#2a0f3f"/></linearGradient>
        <radialGradient id="glow" cx="0.8" cy="0" r="0.75"><stop offset="0" stop-color="#7c5cff" stop-opacity="0.45"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/><rect width="100%" height="100%" fill="url(#glow)"/>
    </svg>`),
  )
    .png()
    .toBuffer();
}

/** Darkens the top (for the site name) and the bottom (for the title), like the post page's banner. */
const SHADE = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#080618" stop-opacity="0.6"/>
    <stop offset="0.24" stop-color="#080618" stop-opacity="0"/>
    <stop offset="0.42" stop-color="#080618" stop-opacity="0.12"/>
    <stop offset="1" stop-color="#080618" stop-opacity="0.94"/>
  </linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#s)"/>
</svg>`);

/** Where to put a single line of text so its capitals are centred on `centerY`. */
const capCenteredTop = (block: TextBlock, centerY: number) => Math.round(centerY + block.capHeight / 2 - block.ascent);

/** The logo and the site name, top left. */
async function brand(): Promise<OverlayOptions[]> {
  const logo = 58;
  const top = 46;
  const name = textBlock(site.name, INTER_BOLD, 28);
  return [
    { input: await logoPng(logo), top, left: MARGIN - 4 },
    { input: name.svg, top: capCenteredTop(name, top + logo / 2), left: MARGIN + logo + 12 },
  ];
}

/** A translucent pill with the category name (the "badge" on the post page's banner). */
function badge(label: string) {
  const text = textBlock(label, INTER_SEMIBOLD, 24);
  const width = text.width + 40;
  const height = 44;
  const pill = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${(height - 2) / 2}" fill="#ffffff" fill-opacity="0.18" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
  </svg>`);
  return {
    height,
    layers: (top: number, left: number): OverlayOptions[] => [
      { input: pill, top, left },
      { input: text.svg, top: capCenteredTop(text, top + height / 2), left: left + 20 },
    ],
  };
}

/** Writes through a temporary file, so a half-written image is never served. */
async function writeAtomic(file: string, data: Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(temp, data);
  await fs.promises.rename(temp, file);
}

/** Changes whenever what the image shows changes, so its URL changes too (platforms cache images by URL). */
export function shareImageVersion(row: RowDataPacket) {
  return crypto
    .createHash('sha1')
    .update([DESIGN, site.name, BRAND_VERSION, row.title, row.banner_url ?? '', row.category_name ?? ''].join('|'))
    .digest('hex')
    .slice(0, 12);
}

/** The share image's path (relative: the page makes it absolute). */
export const shareImagePath = (row: RowDataPacket) => `/api/og/posts/${row.id}.jpg?v=${shareImageVersion(row)}`;

const pending = new Map<string, Promise<string>>();

/** Renders once per version and keeps it on disk; `stale` picks older versions to delete. */
function cached(name: string, render: () => Promise<Buffer>, stale?: (file: string) => boolean) {
  const file = path.join(CACHE_DIR, name);
  if (fs.existsSync(file)) return Promise.resolve(file);
  const running = pending.get(file);
  if (running) return running;
  const job = (async () => {
    await writeAtomic(file, await render());
    if (stale) for (const old of fs.readdirSync(CACHE_DIR)) if (old !== name && stale(old)) fs.rmSync(path.join(CACHE_DIR, old), { force: true });
    return file;
  })().finally(() => pending.delete(file));
  pending.set(file, job);
  return job;
}

/** A post's share image: its banner, the site name, the category and the title. */
export function postShareImage(row: RowDataPacket) {
  const prefix = `post-${row.id}-`;
  return cached(
    `${prefix}${shareImageVersion(row)}.jpg`,
    async () => {
      const title = titleBlock(row.title);
      const titleTop = OG_HEIGHT - 56 - title.height;
      const capsTop = titleTop + title.ascent - title.capHeight;
      const chip = row.category_name ? badge(row.category_name) : null;
      return sharp(await background(row.banner_url))
        .composite([
          { input: SHADE },
          ...(await brand()),
          ...(chip ? chip.layers(Math.round(capsTop - 26 - chip.height), MARGIN) : []),
          { input: title.svg, top: titleTop, left: MARGIN },
        ])
        .jpeg({ quality: 86, mozjpeg: true })
        .toBuffer();
    },
    (old) => old.startsWith(prefix),
  );
}

/** The home page's share image: the site name and description on the site's background. */
export function siteShareImage() {
  const version = crypto.createHash('sha1').update([DESIGN, site.name, BRAND_VERSION, site.description].join('|')).digest('hex').slice(0, 12);
  return {
    version,
    file: () =>
      cached(
        `site-${version}.jpg`,
        async () => {
          const logo = 150;
          const name = textBlock(site.name, FRAUNCES, 96);
          const description = textBlock(site.description, INTER_SEMIBOLD, 34, { color: '#e6e1ff', width: 860, lineHeight: 1.3 });
          const left = MARGIN + 16;
          const total = logo + 24 + name.height + 12 + description.height;
          const top = Math.round((OG_HEIGHT - total) / 2);
          return sharp(await background(null))
            .composite([
              { input: await logoPng(logo), top, left: left - 6 },
              { input: name.svg, top: top + logo + 24, left },
              { input: description.svg, top: top + logo + 24 + name.height + 12, left },
            ])
            .jpeg({ quality: 86, mozjpeg: true })
            .toBuffer();
        },
        (old) => old.startsWith('site-'),
      ),
  };
}

/** The site's logo as a PNG (search engines want a raster logo for the publisher). */
export function logoImage() {
  return cached(`logo-512-${BRAND_VERSION}.png`, () => logoPng(512), (old) => /^logo-512(-[0-9a-f]{8})?\.png$/.test(old));
}

/** The logo for the splash shown when the site opens at its home page (client/index.html): small, as WebP. */
export function splashLogo(size: number) {
  return cached(
    `splash-${size}-${BRAND_VERSION}.webp`,
    async () =>
      sharp(await trimmedLogo())
        .resize(size, size, { fit: 'contain', background: TRANSPARENT })
        .webp({ quality: 82, alphaQuality: 90 })
        .toBuffer(),
    (old) => old.startsWith(`splash-${size}-`),
  );
}

/**
 * Home-screen icons and the favicon, made from the logo. Plain: the logo on a transparent square. Full bleed
 * (Android's maskable icons, Apple's touch icon): the night sky fills the square, since the launcher cuts its own
 * shape (and Apple paints transparency black), and the logo stays inside the safe zone in the middle. The
 * notification badge is a white star: Android draws only its shape, in one colour. Resolves to the cached file.
 */
export function appIcon(size: number, fullBleed: boolean | 'badge') {
  const star = 'M32 12c2 12 8 18 20 20-12 2-18 8-20 20-2-12-8-18-20-20 12-2 18-8 20-20z';
  if (fullBleed === 'badge') {
    const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><path d="${star}" fill="#fff" transform="translate(32 32) scale(1.45) translate(-32 -32)"/></svg>`;
    return cached(`badge-${size}.png`, () => sharp(Buffer.from(badge)).png().toBuffer());
  }
  const kind = `icon-${size}${fullBleed ? '-full' : ''}`;
  return cached(
    `${kind}-${BRAND_VERSION}.png`,
    async () => {
      if (!fullBleed) return logoPng(size);
      return sharp({ create: { width: size, height: size, channels: 4, background: NIGHT } })
        .composite([{ input: await logoPng(Math.round(size * 0.76)), gravity: 'center' }])
        .png(PNG)
        .toBuffer();
    },
    // Earlier versions of this icon (and the star icons from before the logo).
    (old) => new RegExp(`^${kind}(-[0-9a-f]{8})?\\.png$`).test(old),
  );
}

/**
 * /favicon.ico, for browsers and crawlers that ask for it at the root instead of reading the page's icon links: the
 * logo at 16, 32 and 48 px, as PNGs inside an ICO file (understood everywhere since Windows Vista).
 */
export function faviconIco() {
  return cached(
    `favicon-${BRAND_VERSION}.ico`,
    async () => {
      const images = await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await logoPng(size) })));
      const header = Buffer.alloc(6 + 16 * images.length);
      header.writeUInt16LE(0, 0); // reserved
      header.writeUInt16LE(1, 2); // 1: an icon
      header.writeUInt16LE(images.length, 4);
      let offset = header.length;
      images.forEach(({ size, png }, i) => {
        const entry = 6 + 16 * i;
        header.writeUInt8(size, entry); // width
        header.writeUInt8(size, entry + 1); // height
        header.writeUInt8(0, entry + 2); // no palette
        header.writeUInt8(0, entry + 3); // reserved
        header.writeUInt16LE(1, entry + 4); // colour planes
        header.writeUInt16LE(32, entry + 6); // bits per pixel
        header.writeUInt32LE(png.length, entry + 8);
        header.writeUInt32LE(offset, entry + 12);
        offset += png.length;
      });
      return Buffer.concat([header, ...images.map((image) => image.png)]);
    },
    (old) => /^favicon(-[0-9a-f]{8})?\.ico$/.test(old),
  );
}

/** Which of a person's lists a share image is for (/{username}/jurnal, /carti, /salvate). */
export type ProfileList = 'jurnal' | 'carti' | 'salvate';
const PROFILE_LABELS: Record<ProfileList, string> = { jurnal: 'Jurnal', carti: 'Cărți', salvate: 'Articole salvate' };

export interface ProfileImageInput {
  id: number;
  username: string;
  name: string;
  picture: string | null;
  occupation: string | null;
}

/** Changes when what the image shows changes (the platforms keep images by address). */
export function profileShareVersion(person: ProfileImageInput, list: ProfileList) {
  return crypto
    .createHash('sha1')
    .update([DESIGN, site.name, BRAND_VERSION, list, person.name, person.picture ?? '', person.occupation ?? ''].join('|'))
    .digest('hex')
    .slice(0, 12);
}

export const profileSharePath = (person: ProfileImageInput, list: ProfileList) =>
  `/api/og/u/${person.username}/${list}.jpg?v=${profileShareVersion(person, list)}`;

/** A profile picture in a circle; without one (or if it can't be read), the initials on the site's gradient. */
async function avatarCircle(picture: string | null, name: string, size: number) {
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  try {
    let source: Buffer | string | null = null;
    if (picture?.startsWith('/uploads/')) {
      const file = path.join(config.uploadsDir, path.basename(picture));
      if (fs.existsSync(file)) source = file;
    } else if (picture?.startsWith('https://')) {
      const response = await fetch(picture, { signal: AbortSignal.timeout(5000) });
      if (response.ok) source = Buffer.from(await response.arrayBuffer());
    }
    if (source) {
      return await sharp(source).resize(size, size, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    }
  } catch {
    // the initials below
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
  const letters = textBlock(initials || '?', INTER_BOLD, Math.round(size * 0.38));
  const circle = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#ff7a9a"/></linearGradient></defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#a)"/>
  </svg>`);
  return sharp(circle)
    .composite([{ input: letters.svg, left: Math.round((size - letters.width) / 2), top: capCenteredTop(letters, size / 2) }])
    .png()
    .toBuffer();
}

/** A person's list, as link previews show it: their picture, their name, which list, and their occupation. */
export function profileShareImage(person: ProfileImageInput, list: ProfileList) {
  const prefix = `profile-${person.id}-${list}-`;
  return cached(
    `${prefix}${profileShareVersion(person, list)}.jpg`,
    async () => {
      const avatar = 280;
      const left = MARGIN + 16;
      const textLeft = left + avatar + 56;
      const textWidth = OG_WIDTH - textLeft - MARGIN;
      const label = textBlock(PROFILE_LABELS[list], INTER_BOLD, 30, { color: '#f2c46d' });
      let name = textBlock(person.name, FRAUNCES, 72, { width: textWidth, lineHeight: 1.08 });
      if (name.lines > 2) name = textBlock(person.name, FRAUNCES, 56, { width: textWidth, lineHeight: 1.08 });
      const occupation = person.occupation ? textBlock(person.occupation, INTER_SEMIBOLD, 30, { color: '#c5cbf0', width: textWidth }) : null;
      const total = label.height + 16 + name.height + (occupation ? 18 + occupation.height : 0);
      const top = Math.round((OG_HEIGHT - total) / 2) + 20;
      return sharp(await background(null))
        .composite([
          ...(await brand()),
          { input: await avatarCircle(person.picture, person.name, avatar), top: Math.round((OG_HEIGHT - avatar) / 2) + 20, left },
          { input: label.svg, top, left: textLeft },
          { input: name.svg, top: top + label.height + 16, left: textLeft },
          ...(occupation ? [{ input: occupation.svg, top: top + label.height + 16 + name.height + 18, left: textLeft }] : []),
        ])
        .jpeg({ quality: 86, mozjpeg: true })
        .toBuffer();
    },
    (old) => old.startsWith(prefix),
  );
}
