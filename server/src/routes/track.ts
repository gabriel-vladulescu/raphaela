import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { ACTIONS, addReadingTime, recordEvent, recordView } from '@/lib/analytics';
import type { Action } from '@/lib/analytics';
import { notifyShare } from '@/lib/notifications';

const pathSchema = { type: 'string', minLength: 1, maxLength: 2000, pattern: '^/' } as const;
const postIdSchema = { type: ['integer', 'null'], minimum: 1 } as const;
// Generous: a reader sends a view per page and a reading-time report every 15 seconds.
const limit = { rateLimit: { max: 240, timeWindow: '1 minute' } };

/**
 * What the browser reports for the statistics (lib/analytics.ts): pages opened, active reading time and how far
 * into a post, and actions. Crawlers and automated browsers aren't counted.
 */
const trackRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  // Reports sent with navigator.sendBeacon (as a page closes) arrive as text/plain; they're JSON all the same.
  // (Registered here, so it only applies to these routes.)
  app.addContentTypeParser('text/plain', { parseAs: 'string', bodyLimit: 4096 }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('invalid JSON'), { statusCode: 400 }), undefined);
    }
  });

  app.post<{ Body: { path: string; postId?: number | null; referrer?: string; tablet?: boolean; automated?: boolean } }>(
    '/track/view',
    {
      config: limit,
      schema: {
        body: {
          type: 'object',
          required: ['path'],
          additionalProperties: false,
          properties: {
            path: pathSchema,
            postId: postIdSchema,
            referrer: { type: 'string', maxLength: 2000 },
            tablet: { type: 'boolean' },
            automated: { type: 'boolean' },
          },
        },
      },
    },
    async (req) => {
      const counted = req.body.automated ? false : await recordView(db, req, req.body);
      if (!req.body.postId) return { counted };
      // The post's view count, this view included.
      const [rows] = await db.execute<RowDataPacket[]>('SELECT view_count FROM posts WHERE id = ?', [req.body.postId]);
      return { counted, views: rows[0] ? Number(rows[0].view_count) : null };
    },
  );

  app.post<{ Body: { path: string; seconds: number; scroll?: number } }>(
    '/track/time',
    {
      config: limit,
      schema: {
        body: {
          type: 'object',
          required: ['path', 'seconds'],
          additionalProperties: false,
          properties: {
            path: pathSchema,
            seconds: { type: 'number', minimum: 0, maximum: 3600 },
            scroll: { type: 'number', minimum: 0, maximum: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      await addReadingTime(db, req, { path: req.body.path, seconds: req.body.seconds, scroll: req.body.scroll ?? 0 });
      return reply.code(204).send();
    },
  );

  app.post<{ Body: { action: Action; path: string; postId?: number | null; seconds?: number | null } }>(
    '/track/event',
    {
      config: limit,
      schema: {
        body: {
          type: 'object',
          required: ['action', 'path'],
          additionalProperties: false,
          properties: {
            action: { type: 'string', enum: [...ACTIONS] },
            path: pathSchema,
            postId: postIdSchema,
            seconds: { type: ['number', 'null'], minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const first = await recordEvent(db, req, req.body);
      // "Someone shared your post": once a day per visitor, post and app.
      const { action, postId } = req.body;
      if (first && postId && action.startsWith('share:')) {
        void notifyShare(db, { postId, actorId: req.user?.id ?? null, app: action.slice('share:'.length) });
      }
      return reply.code(204).send();
    },
  );
};

export default trackRoutes;
