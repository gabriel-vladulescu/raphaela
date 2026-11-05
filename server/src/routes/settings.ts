import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { requireUser } from '@/lib/guards';
import { MILESTONES, readSettings } from '@/lib/notifications';
import type { NotifySettings } from '@/lib/notifications';

const toggle = { type: 'boolean' } as const;
const thresholds = { type: 'array', maxItems: MILESTONES.length, uniqueItems: true, items: { type: 'integer', enum: [...MILESTONES] } } as const;

/** An account's choices of what to be notified of (the Settings page; lib/notifications.ts reads them). */
const settingsRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  const load = async (userId: number) => {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT notify_settings FROM users WHERE id = ?', [userId]);
    return readSettings(rows[0]?.notify_settings);
  };

  app.get('/me/notification-settings', { preHandler: requireUser }, async (req) => ({ settings: await load(req.user!.id) }));

  // Changes some of them (what's not sent stays as it was).
  app.put<{ Body: Partial<Omit<NotifySettings, 'milestones'>> & { milestones?: Partial<NotifySettings['milestones']> } }>(
    '/me/notification-settings',
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            newPosts: toggle,
            myCommentReplies: toggle,
            myCommentReactions: toggle,
            postLikes: toggle,
            postShares: toggle,
            postComments: toggle,
            postReplies: toggle,
            postReactions: toggle,
            views: toggle,
            viewsEvery: { type: 'integer', minimum: 1, maximum: 100_000 },
            milestones: {
              type: 'object',
              additionalProperties: false,
              properties: { comments: thresholds, likes: thresholds, views: thresholds },
            },
            support: toggle,
            reports: toggle,
            accountDeletions: toggle,
            heldComments: toggle,
            mentions: toggle,
            followedAuthors: toggle,
          },
        },
      },
    },
    async (req) => {
      const current = await load(req.user!.id);
      const settings = readSettings({ ...current, ...req.body, milestones: { ...current.milestones, ...req.body.milestones } });
      await db.execute('UPDATE users SET notify_settings = ? WHERE id = ?', [JSON.stringify(settings), req.user!.id]);
      return { settings };
    },
  );
};

export default settingsRoutes;
