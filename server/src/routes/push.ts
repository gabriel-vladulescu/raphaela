import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { deviceOf } from '@/lib/device';
import { requireUser } from '@/lib/guards';
import { followableBook } from '@/lib/newsletter';
import { endpointHash, pushTo, vapidPublicKey } from '@/lib/push';

interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const endpointSchema = { type: 'string', minLength: 10, maxLength: 1000, pattern: '^https://' } as const;
const subscriptionSchema = {
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
} as const;
const limit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

/**
 * Push notifications on a device, stored with the browser's subscription: signed out, new posts (`newPosts`, the
 * bell's switch); signed in, the account's notifications (`activity`), whatever it chose to hear about (Settings);
 * and anyone, the new chapters of some books ("Notify me" at the end of an unfinished book: push_books). A device
 * getting none of these is forgotten (`kept`: false, and the browser drops its subscription).
 */
const pushRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  /** Keeps the device (its keys, who's on it, and `flags` when given); its id. */
  async function saveDevice(
    subscription: Subscription,
    userId: number | null,
    visitorId: string,
    flags: { new_posts: boolean; activity: boolean } | null,
    device: string | null,
  ) {
    const hash = endpointHash(subscription.endpoint);
    await db.execute(
      `INSERT INTO push_subscriptions (endpoint, endpoint_hash, p256dh, auth, user_id, visitor_id, device, new_posts, activity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth), user_id = VALUES(user_id), visitor_id = VALUES(visitor_id),
                               device = COALESCE(VALUES(device), push_subscriptions.device)
                               ${flags ? ', new_posts = VALUES(new_posts), activity = VALUES(activity)' : ''}`,
      [subscription.endpoint, hash, subscription.keys.p256dh, subscription.keys.auth, userId, visitorId, device, flags?.new_posts ? 1 : 0, flags?.activity ? 1 : 0],
    );
    const [[row]] = await db.execute<RowDataPacket[]>('SELECT id FROM push_subscriptions WHERE endpoint_hash = ?', [hash]);
    return row!.id as number;
  }

  /** A device that gets nothing any more is forgotten. Whether it's still kept. */
  async function forgetIfIdle(hash: string) {
    const [result] = await db.execute(
      `DELETE ps FROM push_subscriptions ps
        WHERE ps.endpoint_hash = ? AND ps.new_posts = 0 AND ps.activity = 0 AND NOT EXISTS (SELECT 1 FROM push_books pb WHERE pb.subscription_id = ps.id)`,
      [hash],
    );
    if ((result as { affectedRows: number }).affectedRows > 0) return false;
    const [rows] = await db.execute<RowDataPacket[]>('SELECT 1 FROM push_subscriptions WHERE endpoint_hash = ?', [hash]);
    return rows.length > 0;
  }

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
            subscription: subscriptionSchema,
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
      await saveDevice(subscription, req.user?.id ?? null, req.visitor.id, { new_posts: newPosts, activity }, deviceOf(req.headers['user-agent']));
      return { newPosts, activity, kept: await forgetIfIdle(endpointHash(subscription.endpoint)) };
    },
  );

  // A book's new chapters on this device, on or off ("Notify me").
  app.post<{ Params: { bookId: number }; Body: { subscription: Subscription; on: boolean } }>(
    '/push/books/:bookId',
    {
      config: limit,
      schema: {
        params: { type: 'object', properties: { bookId: { type: 'integer', minimum: 1 } } },
        body: { type: 'object', required: ['subscription', 'on'], additionalProperties: false, properties: { subscription: subscriptionSchema, on: { type: 'boolean' } } },
      },
    },
    async (req, reply) => {
      const { subscription, on } = req.body;
      const hash = endpointHash(subscription.endpoint);
      if (on) {
        if (!(await followableBook(db, req.params.bookId))) return reply.code(404).send({ error: 'not_found' });
        const id = await saveDevice(subscription, req.user?.id ?? null, req.visitor.id, null, deviceOf(req.headers['user-agent']));
        await db.execute('INSERT IGNORE INTO push_books (subscription_id, book_id, created_at) VALUES (?, ?, UTC_TIMESTAMP())', [id, req.params.bookId]);
        return { on: true, kept: true };
      }
      await db.execute('DELETE pb FROM push_books pb JOIN push_subscriptions ps ON ps.id = pb.subscription_id WHERE ps.endpoint_hash = ? AND pb.book_id = ?', [
        hash,
        req.params.bookId,
      ]);
      return { on: false, kept: await forgetIfIdle(hash) };
    },
  );

  // Whether this device gets a book's new chapters.
  app.post<{ Params: { bookId: number }; Body: { endpoint: string } }>(
    '/push/books/:bookId/state',
    {
      schema: {
        params: { type: 'object', properties: { bookId: { type: 'integer', minimum: 1 } } },
        body: { type: 'object', required: ['endpoint'], additionalProperties: false, properties: { endpoint: endpointSchema } },
      },
    },
    async (req) => {
      const [rows] = await db.execute<RowDataPacket[]>(
        'SELECT 1 FROM push_books pb JOIN push_subscriptions ps ON ps.id = pb.subscription_id WHERE ps.endpoint_hash = ? AND pb.book_id = ?',
        [endpointHash(req.body.endpoint), req.params.bookId],
      );
      return { on: rows.length > 0 };
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
    }, { kind: 'test', userId: req.user!.id });
    return { devices: Number(row!.n) };
  });
};

export default pushRoutes;
