import type { FastifyPluginAsync } from 'fastify';
import { requireWriter } from '@/lib/guards';
import { fetchRemoteImage, RemoteImageError } from '@/lib/remoteImage';
import { saveImage } from '@/lib/uploads';

const uploadRoutes: FastifyPluginAsync = async (app) => {
  // An image from another site, for the banner's "Search images" (an image library, or an address pasted from
  // Google): fetched here, since browsers can't read other sites' images, and handed back to be framed and uploaded
  // like a file from the device. Public internet only (lib/remoteImage.ts); writers only.
  app.get<{ Querystring: { url?: string } }>(
    '/images/fetch',
    {
      preHandler: requireWriter,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { querystring: { type: 'object', required: ['url'], properties: { url: { type: 'string', maxLength: 2000 } } } },
    },
    async (req, reply) => {
      try {
        const image = await fetchRemoteImage(req.query.url!);
        return reply.type(image.type).header('Cache-Control', 'private, no-store').send(image.data);
      } catch (err) {
        const code = err instanceof RemoteImageError ? err.code : 'image_fetch_failed';
        req.log.warn({ url: req.query.url, code, detail: err instanceof RemoteImageError ? err.detail : String(err) }, 'Image fetch refused');
        return reply.code(code === 'image_too_large' ? 413 : 400).send({ error: code });
      }
    },
  );

  // Banner and in-post images (authors and owners). Files are served from /uploads/<name>.
  app.post('/uploads', { preHandler: requireWriter }, async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'file_missing' });
    const saved = await saveImage(file);
    if ('error' in saved) return reply.code(400).send(saved);
    return saved;
  });
};

export default uploadRoutes;
