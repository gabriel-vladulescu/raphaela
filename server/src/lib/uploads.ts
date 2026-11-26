import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MultipartFile } from '@fastify/multipart';
import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { config } from '@/config';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

/** Longest side of a stored image: 1080p, the largest the site shows (the 1192px-wide post banner, sharp on dense screens). */
export const MAX_IMAGE_SIDE = 1920;
/** Profile pictures' file names start with it. */
export const AVATAR_PREFIX = 'avatar-';

/**
 * Saves an uploaded image as WebP under the uploads folder and returns its URL (/uploads/<prefix><random>.webp).
 * Larger images are scaled down to `maxSide` (never up), at high quality; WebP files that already fit are kept
 * byte for byte, so they don't lose quality to a second encoding. GIFs are kept as they are (animations), once
 * they're known to be images. `minSide`: refused when its shorter side is smaller (`image_too_small`).
 */
export async function saveImage(
  file: MultipartFile,
  { prefix = '', maxSide = MAX_IMAGE_SIDE, minSide = 0 } = {},
): Promise<{ url: string } | { error: string }> {
  if (!IMAGE_TYPES.includes(file.mimetype)) {
    file.file.resume(); // drain the stream so the request completes
    return { error: 'file_type' };
  }
  const input = await file.toBuffer(); // over the size limit: a 413, handled by the error handler

  // Whatever it says it is, it must really be an image (GIFs too, though they're kept as they are).
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    return { error: 'file_type' };
  }
  if (!meta.width || !meta.height) return { error: 'file_type' };
  if (Math.min(meta.width, meta.height) < minSide) return { error: 'image_too_small' };

  let output = input;
  let extension = 'gif';
  // By what the file is, not what the browser said (a PNG named .gif is encoded like any other).
  if (meta.format !== 'gif') {
    const fits = (meta.width ?? 0) <= maxSide && (meta.height ?? 0) <= maxSide;
    // Re-encoding also drops EXIF (location) and applies the camera's rotation.
    const keepAsIs = meta.format === 'webp' && fits && !meta.orientation && !meta.exif && !meta.xmp;
    if (!keepAsIs) {
      output = await sharp(input, { animated: (meta.pages ?? 1) > 1 })
        .rotate()
        .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90, smartSubsample: true, effort: 5 })
        .toBuffer();
    }
    extension = 'webp';
  }

  const name = `${prefix}${crypto.randomBytes(16).toString('hex')}.${extension}`;
  await fs.promises.writeFile(path.join(config.uploadsDir, name), output);
  return { url: `/uploads/${name}` };
}

/**
 * Deletes a file we saved, given its /uploads/ URL; anything else is left alone. On Windows a file that's being read
 * (served, scanned) can't be deleted for a moment: it's tried a few times, then left (a stray file is harmless, and
 * the change it went with is already saved).
 */
export async function removeUpload(url: string | null, prefix: string) {
  const name = url?.startsWith(`/uploads/${prefix}`) ? url.slice('/uploads/'.length) : null;
  if (!name || !/^[\w.-]+$/.test(name)) return;
  // `recursive` is what makes Node retry on EBUSY / EPERM (it's a single file either way).
  await fs.promises.rm(path.join(config.uploadsDir, name), { force: true, recursive: true, maxRetries: 4, retryDelay: 150 }).catch(() => undefined);
}
