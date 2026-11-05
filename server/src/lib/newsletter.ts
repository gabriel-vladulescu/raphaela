import crypto from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { newsletterConfirmEmail, newsletterDigestEmail, newsletterPostEmail, siteLink } from '@/lib/emails';
import type { Lang, NewsletterPost } from '@/lib/emails';
import { canSendMail, mailSettings, sendMail } from '@/lib/mail';
import { summaryOf, TEXT_START, VISIBLE_POST } from '@/lib/posts';
import { site } from '@/lib/siteIdentity';
import { siteSettings } from '@/lib/siteSettings';
import { siteDay, siteDayStart } from '@/lib/analytics';

// The newsletter: anyone can get new posts by email, at once ("instant") or once a week (Monday morning, the
// week's posts). Subscribing is confirmed by a link (double opt-in); every email has a link to change or stop it, and
// a one-click unsubscribe header. Sent a few at a time (newsletterTick, every minute), and never past the email
// server's daily limit (it leaves a margin for the account emails).

export type Frequency = 'instant' | 'weekly';
/** How many emails one tick sends at most (SMTP servers dislike bursts). */
const BATCH = 20;
/** The newsletter stops for the day at this share of the server's daily limit. */
const LIMIT_SHARE = 0.9;
/** A post goes to subscribers at most this long after it went up (a server down for a while doesn't send old news). */
const FRESH_DAYS = 7;

const manageUrl = (token: string) => siteLink(`/newsletter/${token}`);
const unsubscribeUrl = (token: string) => siteLink(`/api/newsletter/unsubscribe/${token}`);
const newToken = () => crypto.randomBytes(32).toString('base64url');

export type SubscribeResult = 'pending' | 'confirmed' | 'already';

/**
 * Subscribes an address: a confirmation link goes to it, unless it's the signed-in person's own confirmed address
 * (then it's confirmed at once). An address already subscribed keeps its subscription (with the new frequency).
 */
export async function subscribe(db: Pool, input: { email: string; frequency: Frequency; lang: Lang; user: { id: number; email: string; emailVerified: boolean } | null }): Promise<SubscribeResult> {
  const email = input.email.trim().toLowerCase();
  const trusted = input.user !== null && input.user.emailVerified && input.user.email === email;
  const [rows] = await db.execute<RowDataPacket[]>('SELECT id, token, confirmed_at, unsubscribed_at FROM newsletter_subscribers WHERE email = ?', [email]);
  const existing = rows[0];
  if (existing && existing.confirmed_at && !existing.unsubscribed_at) {
    await db.execute('UPDATE newsletter_subscribers SET frequency = ?, lang = ? WHERE id = ?', [input.frequency, input.lang, existing.id]);
    return 'already';
  }
  const token = (existing?.token as string | undefined) ?? newToken();
  if (existing) {
    await db.execute(
      `UPDATE newsletter_subscribers SET frequency = ?, lang = ?, user_id = COALESCE(?, user_id), unsubscribed_at = NULL,
              confirmed_at = ${trusted ? 'UTC_TIMESTAMP()' : 'NULL'}, last_digest_at = NULL
        WHERE id = ?`,
      [input.frequency, input.lang, input.user?.id ?? null, existing.id],
    );
  } else {
    await db.execute(
      `INSERT INTO newsletter_subscribers (email, user_id, frequency, lang, token, created_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), ${trusted ? 'UTC_TIMESTAMP()' : 'NULL'})`,
      [email, input.user?.id ?? null, input.frequency, input.lang, token],
    );
  }
  if (trusted) return 'confirmed';
  void sendMail(newsletterConfirmEmail(email, input.lang, siteLink(`/newsletter/confirmare?token=${token}`)));
  return 'pending';
}

export async function confirmSubscription(db: Pool, token: string) {
  const [rows] = await db.execute<RowDataPacket[]>('SELECT id, email FROM newsletter_subscribers WHERE token = ?', [token]);
  if (!rows[0]) return null;
  await db.execute('UPDATE newsletter_subscribers SET confirmed_at = COALESCE(confirmed_at, UTC_TIMESTAMP()), unsubscribed_at = NULL WHERE id = ?', [rows[0].id]);
  return rows[0].email as string;
}

export async function findSubscription(db: Pool, by: { token?: string; email?: string }) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, email, frequency, lang, token, confirmed_at, unsubscribed_at FROM newsletter_subscribers WHERE ${by.token ? 'token' : 'email'} = ?`,
    [by.token ?? by.email ?? ''],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id as number,
        email: row.email as string,
        frequency: row.frequency as Frequency,
        lang: row.lang as Lang,
        token: row.token as string,
        confirmed: row.confirmed_at !== null,
        active: row.confirmed_at !== null && row.unsubscribed_at === null,
      }
    : null;
}

export async function unsubscribe(db: Pool, token: string) {
  const [result] = await db.execute('UPDATE newsletter_subscribers SET unsubscribed_at = COALESCE(unsubscribed_at, UTC_TIMESTAMP()) WHERE token = ?', [token]);
  return (result as { affectedRows: number }).affectedRows > 0;
}

/** Emails sent today, against the server's daily limit: what's left for the newsletter (Infinity without a limit). */
async function budget(db: Pool) {
  const limit = mailSettings().dailyLimit;
  if (!limit) return Infinity;
  const [[row]] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM email_log WHERE status = 'sent' AND created_at >= ?", [siteDayStart(siteDay())]);
  return Math.max(0, Math.floor(limit * LIMIT_SHARE) - Number(row!.n));
}

const asNewsletterPost = (row: RowDataPacket): NewsletterPost => ({
  title: row.title as string,
  summary: summaryOf(row),
  url: siteLink(`/posts/${row.slug as string}`),
  image: row.banner_url ? (String(row.banner_url).startsWith('/') ? siteLink(row.banner_url as string) : (row.banner_url as string)) : null,
});

/** Monday 09:00 (the site's time zone) of this week, once it has come; null before it. */
function digestTime(now = new Date()) {
  const local = new Date(now.toLocaleString('en-US', { timeZone: site.timeZone }));
  const daysSinceMonday = (local.getDay() + 6) % 7;
  const monday = new Date(siteDayStart(siteDay(new Date(now.getTime() - daysSinceMonday * 86_400_000))).getTime() + 9 * 3_600_000);
  return now >= monday ? monday : null;
}

/** Every minute (index.ts): the next few emails of the newsletter, instant ones first, then the weekly digests. */
export async function newsletterTick(db: Pool) {
  try {
    if (!siteSettings().newsletterEnabled || !canSendMail()) return;
    let left = Math.min(BATCH, await budget(db));
    if (left <= 0) return;

    // Instant: each post that went up, to each subscriber who was there before it and hasn't had it.
    const [due] = await db.query<RowDataPacket[]>(
      `SELECT s.id AS subscriber_id, s.email, s.lang, s.token, p.id AS post_id, p.title, p.slug, p.excerpt, ${TEXT_START}, p.banner_url
         FROM posts p
         JOIN newsletter_subscribers s ON s.frequency = 'instant' AND s.confirmed_at IS NOT NULL AND s.unsubscribed_at IS NULL AND s.confirmed_at <= p.newsletter_at
         LEFT JOIN newsletter_deliveries d ON d.subscriber_id = s.id AND d.post_id = p.id
        WHERE p.newsletter_at IS NOT NULL AND p.newsletter_at > UTC_TIMESTAMP() - INTERVAL ${FRESH_DAYS} DAY
          AND p.published_at > UTC_TIMESTAMP() - INTERVAL ${FRESH_DAYS} DAY AND ${VISIBLE_POST} AND d.post_id IS NULL
        ORDER BY p.newsletter_at, s.id
        LIMIT ?`,
      [left],
    );
    for (const row of due) {
      // Claimed first, so it's never sent twice.
      const [claimed] = await db.execute('INSERT IGNORE INTO newsletter_deliveries (subscriber_id, post_id, sent_at) VALUES (?, ?, UTC_TIMESTAMP())', [row.subscriber_id, row.post_id]);
      if ((claimed as { affectedRows: number }).affectedRows === 0) continue;
      await sendMail(newsletterPostEmail(row.email as string, row.lang as Lang, asNewsletterPost(row), manageUrl(row.token as string), unsubscribeUrl(row.token as string)));
      left -= 1;
    }
    if (left <= 0) return;

    // Weekly: on Monday morning, the posts since their last digest (or since they subscribed).
    const monday = digestTime();
    if (!monday) return;
    const [weekly] = await db.query<RowDataPacket[]>(
      `SELECT id, email, lang, token, COALESCE(last_digest_at, confirmed_at) AS since FROM newsletter_subscribers
        WHERE frequency = 'weekly' AND confirmed_at IS NOT NULL AND unsubscribed_at IS NULL AND (last_digest_at IS NULL OR last_digest_at < ?)
        ORDER BY id LIMIT ?`,
      [monday, left],
    );
    for (const sub of weekly) {
      await db.execute('UPDATE newsletter_subscribers SET last_digest_at = UTC_TIMESTAMP() WHERE id = ?', [sub.id]);
      const [posts] = await db.query<RowDataPacket[]>(
        `SELECT p.id, p.title, p.slug, p.excerpt, ${TEXT_START}, p.banner_url FROM posts p
          WHERE ${VISIBLE_POST} AND p.published_at > ? ORDER BY p.published_at DESC LIMIT 10`,
        [sub.since],
      );
      if (posts.length === 0) continue;
      await sendMail(newsletterDigestEmail(sub.email as string, sub.lang as Lang, posts.map(asNewsletterPost), manageUrl(sub.token as string), unsubscribeUrl(sub.token as string)));
    }
  } catch (err) {
    console.warn('Newsletter failed:', (err as Error).message);
  }
}
