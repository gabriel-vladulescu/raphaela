import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { requireUser } from '@/lib/guards';
import { endpointHash, pushTo, vapidPublicKey } from '@/lib/push';

interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const endpointSchema = { type: 'string', minLength: 10, maxLength: 1000, pattern: '^https://' } as const;
const limit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

/**
 * Push notifications on a device, stored with the browser's subscription: signed out, new posts (`newPosts`, the
 * bell's switch); signed in, the account's notifications (`activity`), whatever it chose to hear about (Settings).
 */
const pushRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get('/push/key', async () => ({ key: vapidPublicKey() }));

  // Turns the choices on or off for this device (both off: forgotten).
  app.post<{ Body: { subscription: Subscription; newPosts: boolean; activity: boolean } }>(
    '/push/subscription',
    {
      config: limit,
      schema: {
        body: {
          type: 'object',
          required: ['subscription', 'newPosts', 'activity'],
          additionalProperties: false,
          properties: {
            subscription: {
              type: 'object',
              required: ['endpoint', 'keys'],
              properties: {
                endpoint: endpointSchema,
                keys: {
                  type: 'object',
                  required: ['p256dh', 'auth'],
                  properties: { p256dh: { type: 'string', maxLength: 255 }, auth: { type: 'string', maxLength: 100 } },
                },
              },
            },
            newPosts: { type: 'boolean' },
            activity: { type: 'boolean' },
          },
        },
      },
    },
    async (req) => {
      const { subscription, newPosts } = req.body;
      // An account's notifications only on its own devices.
      const activity = req.body.activity && req.user !== null;
      const hash = endpointHash(subscription.endpoint);
      if (!newPosts && !activity) {
        await db.execute('DELETE FROM push_subscriptions WHERE endpoint_hash = ?', [hash]);
        return { newPosts: false, activity: false };
      }
      await db.execute(
        `INSERT INTO push_subscriptions (endpoint, endpoint_hash, p256dh, auth, user_id, visitor_id, new_posts, activity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE p256dh = new.p256dh, auth = new.auth, user_id = new.user_id, visitor_id = new.visitor_id,
                                 new_posts = new.new_posts, activity = new.activity`,
        [
          subscription.endpoint,
          hash,
          subscription.keys.p256dh,
          subscription.keys.auth,
          req.user?.id ?? null,
          req.visitor.id,
          newPosts ? 1 : 0,
          activity ? 1 : 0,
        ],
      );
      return { newPosts, activity };
    },
  );

  // What this device gets now (the toggles show it).
  app.post<{ Body: { endpoint: string } }>(
    '/push/subscription/state',
    { schema: { body: { type: 'object', required: ['endpoint'], additionalProperties: false, properties: { endpoint: endpointSchema } } } },
    async (req) => {
      const [rows] = await db.execute<RowDataPacket[]>('SELECT new_posts, activity, user_id FROM push_subscriptions WHERE endpoint_hash = ?', [
        endpointHash(req.body.endpoint),
      ]);
      const row = rows[0];
      return {
        newPosts: Boolean(row?.new_posts),
        // Someone else's notifications don't count for this account.
        activity: Boolean(row?.activity) && row?.user_id === req.user?.id,
      };
    },
  );

  // "Send a test": checks that notifications reach this account's devices.
  app.post('/push/test', { preHandler: requireUser, config: limit }, async (req) => {
    const [[row]] = await db.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ? AND activity = 1', [req.user!.id]);
    await pushTo(db, 'user_id = ? AND activity = 1', [req.user!.id], {
      title: 'Notificările funcționează ✨',
      body: 'Așa vor arăta notificările tale.',
      url: '/notificari',
      tag: 'test',
    });
    return { devices: Number(row!.n) };
  });
};

export default pushRoutes;
