/** The server refuses bigger uploads; bigger images are shrunk in the browser first. */
export const UPLOAD_LIMIT = 25 * 1024 * 1024;
/** The most the site ever needs: 1080p, which keeps the 1192px-wide post banner sharp on high-density screens too. */
export const MAX_IMAGE_SIDE = 1920;
const WEBP_QUALITY = 0.95;

/** Draws part of an image at a new size; big reductions go in halves first, which keeps it sharp. */
export function drawScaled(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, width: number, height: number) {
  let source = image;
  while (sw / 2 >= width) {
    const step = document.createElement('canvas');
    step.width = Math.round(sw / 2);
    step.height = Math.round(sh / 2);
    const context = step.getContext('2d')!;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, sx, sy, sw, sh, 0, 0, step.width, step.height);
    [source, sx, sy, sw, sh] = [step, 0, 0, step.width, step.height];
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
  return canvas;
}

/** WebP at high quality, or PNG (lossless) where the browser can't write WebP; the server converts that. */
export function encodeImage(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode_failed'))), 'image/webp', WEBP_QUALITY));
}

/** Files over the upload limit are scaled down to at most MAX_IMAGE_SIDE; others go as they are. */
export async function shrinkIfTooBig(file: File): Promise<File> {
  if (file.size <= UPLOAD_LIMIT || file.type === 'image/gif') return file;
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // not something the browser can read: the server answers with the reason
  }
  const ratio = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.width, image.height));
  const canvas = drawScaled(image, 0, 0, image.width, image.height, Math.round(image.width * ratio), Math.round(image.height * ratio));
  image.close();
  const blob = await encodeImage(canvas);
  const name = file.name.replace(/\.[^.]+$/, '') + (blob.type === 'image/webp' ? '.webp' : '.png');
  return new File([blob], name, { type: blob.type });
}
