import type { FastifyPluginAsync } from 'fastify';
import { requireWriter } from '@/lib/guards';
import { saveImage } from '@/lib/uploads';

const uploadRoutes: FastifyPluginAsync = async (app) => {
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
