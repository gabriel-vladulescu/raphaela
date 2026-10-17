import fs from 'node:fs';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { parseId } from '@/lib/guards';
import { VISIBLE_POST } from '@/lib/posts';
import { logoImage, postShareImage, profileShareImage, profileShareVersion, shareImageVersion, siteShareImage } from '@/seo/og';
import { findPerson } from '@/lib/people';
import { describePage } from '@/seo/page';

/** Versioned URLs never change content, so platforms and browsers can keep them; others are rechecked. */
function sendImage(reply: FastifyReply, file: string, type: string, current: boolean) {
  reply.header('Cache-Control', current ? 'public, max-age=31536000, immutable' : 'public, max-age=600');
  return reply.type(type).send(fs.createReadStream(file));
}

const seoRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  // The title, tags and initial content of a page (Vite's dev server puts them into index.html, as this server
  // does itself in production).
  app.get<{ Querystring: { path: string } }>(
    '/seo/page',
    { schema: { querystring: { type: 'object', required: ['path'], properties: { path: { type: 'string', maxLength: 2000 } } } } },
    async (req) => describePage(db, req.query.path),
  );

  // A post's share image (link previews): its banner with the title, category and site name over it.
  app.get<{ Params: { file: string }; Querystring: { v?: string } }>('/og/posts/:file', async (req, reply) => {
    const id = parseId(req.params.file.replace(/\.jpg$/, ''));
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT p.id, p.title, p.banner_url, c.name AS category_name
         FROM posts p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id = ? AND ${VISIBLE_POST}`,
      [id ?? 0],
    );
    const row = rows[0];
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return sendImage(reply, await postShareImage(row), 'image/jpeg', req.query.v === shareImageVersion(row));
  });

  app.get<{ Querystring: { v?: string } }>('/og/site.jpg', async (req, reply) => {
    const image = siteShareImage();
    return sendImage(reply, await image.file(), 'image/jpeg', req.query.v === image.version);
  });

  app.get('/og/logo.png', async (_req, reply) => sendImage(reply, await logoImage(), 'image/png', false));

  // A person's list (/{username}/articole, /{username}/articole-salvate), when it's public.
  app.get<{ Params: { username: string; file: string }; Querystring: { v?: string } }>('/og/u/:username/:file', async (req, reply) => {
    const list = req.params.file.replace(/\.jpg$/, '');
    if (list !== 'articole' && list !== 'articole-salvate') return reply.code(404).send({ error: 'not_found' });
    const person = await findPerson(db, req.params.username);
    if (!person || !(list === 'articole' ? person.publicArticles : person.publicSaved)) return reply.code(404).send({ error: 'not_found' });
    return sendImage(reply, await profileShareImage(person, list), 'image/jpeg', req.query.v === profileShareVersion(person, list));
  });
};

export default seoRoutes;
