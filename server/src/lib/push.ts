import crypto from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import webpush from 'web-push';
import { config } from '@/config';
import { logError } from '@/lib/errorLog';

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
    await db.query("INSERT INTO app_settings (name, value) VALUES ('vapid_public', ?), ('vapid_private', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [
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
 * that unsubscribed (the push service answers 404 or 410) are forgotten; any other refusal is an error (the error
 * log). Each push that had devices to go to is kept in the history (push_log): to how many, how many got it.
 * Never throws: a push is a nice-to-have.
 */
export async function pushTo(db: Pool, where: string, params: unknown[], message: PushMessage, log: PushLog) {
  try {
    const [subscriptions] = await db.query<RowDataPacket[]>(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE ${where}`, params);
    if (subscriptions.length === 0) return;
    const payload = JSON.stringify(message);
    let sent = 0;
    let gone = 0;
    let firstError: string | null = null;
    await Promise.all(
      subscriptions.map(async (row) => {
        try {
          await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, { TTL: 24 * 60 * 60 });
          await db.execute('UPDATE push_subscriptions SET last_sent_at = UTC_TIMESTAMP() WHERE id = ?', [row.id]);
          sent += 1;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            gone += 1;
            await db.execute('DELETE FROM push_subscriptions WHERE id = ?', [row.id]);
          } else {
            const reason = status ? `the push service answered ${status}` : (err as Error).message;
            firstError ??= reason;
            logError('push', `push (${log.kind})`, new Error(`A push wasn't delivered: ${reason}`));
          }
        }
      }),
    );
    const failed = subscriptions.length - sent - gone;
    await db.execute(
      `INSERT INTO push_log (created_at, kind, title, url, user_id, devices, sent, failed, gone, error)
       VALUES (UTC_TIMESTAMP(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [log.kind.slice(0, 30), message.title.slice(0, 255), message.url.slice(0, 500), log.userId ?? null, subscriptions.length, sent, failed, gone, firstError],
    );
  } catch (err) {
    logError('push', `push (${log.kind})`, err);
  }
}

/** What a push is, for the history (push_log): its kind (a notification's type, new_post, chapter, test), and the
 *  one account it was for, when it was for one. */
export interface PushLog {
  kind: string;
  userId?: number | null;
}
