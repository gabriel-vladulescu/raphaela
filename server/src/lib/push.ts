import crypto from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import webpush from 'web-push';
import { config } from '@/config';

/** What a push shows: the phone's notification, and where tapping it leads. */
export interface PushMessage {
  title: string;
  body: string;
  /** A page of the site ("/posts/…"). */
  url: string;
  /** Same tag: a newer notification replaces the older one on the phone instead of piling up. */
  tag?: string;
}

let publicKey = '';

/**
 * The VAPID keys that identify this server to the push services: made on first start and kept in app_settings.
 * The contact the push services may use is PUSH_CONTACT (a mailto: or https: address), else the site's https
 * address, else a placeholder (fine for testing).
 */
export async function initPush(db: Pool) {
  const [rows] = await db.query<RowDataPacket[]>("SELECT name, value FROM app_settings WHERE name IN ('vapid_public', 'vapid_private')");
  const saved = new Map(rows.map((row) => [row.name as string, row.value as string]));
  let privateKey = saved.get('vapid_private');
  publicKey = saved.get('vapid_public') ?? '';
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    await db.query("INSERT INTO app_settings (name, value) VALUES ('vapid_public', ?), ('vapid_private', ?) AS new ON DUPLICATE KEY UPDATE value = new.value", [
      publicKey,
      privateKey,
    ]);
  }
  const contact = process.env.PUSH_CONTACT ?? (config.appUrl.startsWith('https://') ? config.appUrl : 'mailto:push@example.com');
  webpush.setVapidDetails(contact, publicKey, privateKey);
}

/** The key browsers subscribe with. */
export const vapidPublicKey = () => publicKey;

export const endpointHash = (endpoint: string) => crypto.createHash('sha256').update(endpoint).digest('hex');

/**
 * Sends a push to the devices matching `where` (an SQL condition on push_subscriptions, with its params). Devices
 * that unsubscribed (the push service answers 404 or 410) are forgotten. Never throws: a push is a nice-to-have.
 */
export async function pushTo(db: Pool, where: string, params: unknown[], message: PushMessage) {
  try {
    const [subscriptions] = await db.query<RowDataPacket[]>(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE ${where}`, params);
    const payload = JSON.stringify(message);
    await Promise.all(
      subscriptions.map(async (row) => {
        try {
          await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, { TTL: 24 * 60 * 60 });
          await db.execute('UPDATE push_subscriptions SET last_sent_at = UTC_TIMESTAMP() WHERE id = ?', [row.id]);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await db.execute('DELETE FROM push_subscriptions WHERE id = ?', [row.id]);
          else console.warn(`Push to subscription ${row.id} failed (${status ?? (err as Error).message})`);
        }
      }),
    );
  } catch (err) {
    console.warn('Push failed:', (err as Error).message);
  }
}
