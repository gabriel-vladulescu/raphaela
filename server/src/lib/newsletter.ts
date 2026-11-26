import crypto from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { publicBook } from '@/lib/books';
import { newsletterConfirmEmail, newsletterPostEmail, siteLink } from '@/lib/emails';
import type { Lang, NewsletterPost } from '@/lib/emails';
import { logError } from '@/lib/errorLog';
import { mailConfigured, mailSettings, sendMail } from '@/lib/mail';
import { postPath, summaryOf, TEXT_START, VISIBLE_POST } from '@/lib/posts';
import { siteSettings } from '@/lib/siteSettings';
import { siteDay, siteDayStart } from '@/lib/analytics';

// The newsletter: anyone can get new posts by email, each when it's out: every new post, or only the chapters of
// some books ("Notify me" at the end of an unfinished book). Subscribing is confirmed by a link (double opt-in); every
// email has a link to change or stop it, and a one-click unsubscribe header. Sent a few at a time (newsletterTick, every minute), and never past the email
// server's daily limit (it leaves a margin for the account emails).

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

/** A book that can be followed ("Notify me"): one readers see. Its id and title, or null. */
export async function followableBook(db: Pool, bookId: number) {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT bk.id, bk.title FROM books bk WHERE bk.id = ? AND ${publicBook()}`, [bookId]);
  return rows[0] ? { id: rows[0].id as number, title: rows[0].title as string } : null;
}

/**
 * Subscribes an address to every new post, or (`book`) to a book's new chapters. A confirmation link goes to it,
 * unless it's the signed-in person's own confirmed address or it's confirmed already (then it's on at once).
 * `already`: it was getting that already.
 */
export async function subscribe(
  db: Pool,
  input: { email: string; book: { id: number; title: string } | null; lang: Lang; user: { id: number; email: string; emailVerified: boolean } | null },
): Promise<SubscribeResult> {
  const { book } = input;
  const email = input.email.trim().toLowerCase();
  const trusted = input.user !== null && input.user.emailVerified && input.user.email === email;
  const [rows] = await db.execute<RowDataPacket[]>('SELECT id, token, all_posts, confirmed_at, unsubscribed_at FROM newsletter_subscribers WHERE email = ?', [email]);
  const existing = rows[0];
  const addBook = async (id: number) => {
    if (!book) return false;
    const [added] = await db.execute('INSERT IGNORE INTO newsletter_books (subscriber_id, book_id, created_at) VALUES (?, ?, UTC_TIMESTAMP())', [id, book.id]);
    return (added as { affectedRows: number }).affectedRows > 0;
  };

  if (existing && existing.confirmed_at && !existing.unsubscribed_at) {
    await db.execute('UPDATE newsletter_subscribers SET lang = ?, user_id = COALESCE(?, user_id) WHERE id = ?', [input.lang, input.user?.id ?? null, existing.id]);
    // A book: on at once (the address is confirmed); "already" when every new post (the chapters too) came already.
    if (book) return (await addBook(existing.id as number)) && !existing.all_posts ? 'confirmed' : 'already';
    if (existing.all_posts) return 'already';
    await db.execute('UPDATE newsletter_subscribers SET all_posts = 1 WHERE id = ?', [existing.id]);
    return 'confirmed';
  }

  // New, waiting to be confirmed, or stopped: every new post (asked for now, or before, while waiting), or the book.
  const token = (existing?.token as string | undefined) ?? newToken();
  const allPosts = !book || Boolean(existing && existing.all_posts && !existing.unsubscribed_at);
  let id = existing?.id as number | undefined;
  if (existing) {
    // Stopped: it starts over (no books from before).
    if (existing.unsubscribed_at) await db.execute('DELETE FROM newsletter_books WHERE subscriber_id = ?', [existing.id]);
    await db.execute(
      `UPDATE newsletter_subscribers SET all_posts = ?, lang = ?, user_id = COALESCE(?, user_id), unsubscribed_at = NULL,
              confirmed_at = ${trusted ? 'UTC_TIMESTAMP()' : 'NULL'}
        WHERE id = ?`,
      [allPosts ? 1 : 0, input.lang, input.user?.id ?? null, existing.id],
    );
  } else {
    const [inserted] = await db.execute<ResultSetHeader>(
      `INSERT INTO newsletter_subscribers (email, user_id, lang, all_posts, token, created_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), ${trusted ? 'UTC_TIMESTAMP()' : 'NULL'})`,
      [email, input.user?.id ?? null, input.lang, allPosts ? 1 : 0, token],
    );
    id = inserted.insertId;
  }
  await addBook(id!);
  if (trusted) return 'confirmed';
  void sendMail(newsletterConfirmEmail(email, input.lang, siteLink(`/newsletter/confirmare?token=${token}`), book?.title ?? null));
  return 'pending';
}

export async function confirmSubscription(db: Pool, token: string) {
  const [rows] = await db.execute<RowDataPacket[]>('SELECT id, email FROM newsletter_subscribers WHERE token = ?', [token]);
  if (!rows[0]) return null;
  await db.execute('UPDATE newsletter_subscribers SET confirmed_at = COALESCE(confirmed_at, UTC_TIMESTAMP()), unsubscribed_at = NULL WHERE id = ?', [rows[0].id]);
  return rows[0].email as string;
}

/** A subscription: its address, whether it gets every new post, the books it follows, and whether it's on. */
export async function findSubscription(db: Pool, by: { token?: string; email?: string }) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, email, lang, all_posts, token, confirmed_at, unsubscribed_at FROM newsletter_subscribers WHERE ${by.token ? 'token' : 'email'} = ?`,
    [by.token ?? by.email ?? ''],
  );
  const row = rows[0];
  if (!row) return null;
  const [books] = await db.execute<RowDataPacket[]>(
    'SELECT bk.id, bk.title, bk.slug FROM newsletter_books nb JOIN books bk ON bk.id = nb.book_id WHERE nb.subscriber_id = ? AND bk.deleted_at IS NULL ORDER BY nb.created_at',
    [row.id],
  );
  return {
    id: row.id as number,
    email: row.email as string,
    lang: row.lang as Lang,
    token: row.token as string,
    allPosts: Boolean(row.all_posts),
    books: books.map((book) => ({ id: book.id as number, title: book.title as string, slug: book.slug as string })),
    confirmed: row.confirmed_at !== null,
    active: row.confirmed_at !== null && row.unsubscribed_at === null,
  };
}

/** Nothing left to get (no new posts, no books): it's stopped. */
async function stopIfEmpty(db: Pool, id: number) {
  await db.execute(
    `UPDATE newsletter_subscribers s SET s.unsubscribed_at = COALESCE(s.unsubscribed_at, UTC_TIMESTAMP())
      WHERE s.id = ? AND s.all_posts = 0 AND NOT EXISTS (SELECT 1 FROM newsletter_books nb WHERE nb.subscriber_id = s.id)`,
    [id],
  );
}

/** Every new post, on or off (the manage page, Settings). On again, a stopped subscription starts again. */
export async function setAllPosts(db: Pool, id: number, on: boolean) {
  await db.execute(`UPDATE newsletter_subscribers SET all_posts = ?${on ? ', unsubscribed_at = NULL' : ''} WHERE id = ?`, [on ? 1 : 0, id]);
  if (!on) await stopIfEmpty(db, id);
}

/** No more emails about a book's chapters. */
export async function dropBook(db: Pool, id: number, bookId: number) {
  await db.execute('DELETE FROM newsletter_books WHERE subscriber_id = ? AND book_id = ?', [id, bookId]);
  await stopIfEmpty(db, id);
}

/** Stops everything for the address (the books it followed go too). */
export async function unsubscribe(db: Pool, token: string) {
  const [result] = await db.execute('UPDATE newsletter_subscribers SET unsubscribed_at = COALESCE(unsubscribed_at, UTC_TIMESTAMP()) WHERE token = ?', [token]);
  await db.execute('DELETE nb FROM newsletter_books nb JOIN newsletter_subscribers s ON s.id = nb.subscriber_id WHERE s.token = ?', [token]);
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
  url: siteLink(postPath(row.slug as string, (row.book_slug as string | null) ?? null)),
  image: row.banner_url ? (String(row.banner_url).startsWith('/') ? siteLink(row.banner_url as string) : (row.banner_url as string)) : null,
  book: (row.book_title as string | null) ?? null,
});

/**
 * Every minute (index.ts): the next few emails of the newsletter. Each post that went up, to each subscriber who was
 * there before it and hasn't had it: those who get every new post, and (a chapter) those who follow its book.
 */
export async function newsletterTick(db: Pool) {
  try {
    if (!siteSettings().newsletterEnabled || !mailConfigured()) return;
    const left = Math.min(BATCH, await budget(db));
    if (left <= 0) return;

    const [due] = await db.query<RowDataPacket[]>(
      `SELECT s.id AS subscriber_id, s.email, s.lang, s.token, p.id AS post_id, p.title, p.slug, bk.slug AS book_slug, bk.title AS book_title,
              p.excerpt, ${TEXT_START}, p.banner_url
         FROM posts p
         LEFT JOIN books bk ON bk.id = p.book_id
         JOIN newsletter_subscribers s ON s.confirmed_at IS NOT NULL AND s.unsubscribed_at IS NULL AND s.confirmed_at <= p.newsletter_at
         LEFT JOIN newsletter_deliveries d ON d.subscriber_id = s.id AND d.post_id = p.id
        WHERE p.newsletter_at IS NOT NULL AND p.newsletter_at > UTC_TIMESTAMP() - INTERVAL ${FRESH_DAYS} DAY
          AND p.published_at > UTC_TIMESTAMP() - INTERVAL ${FRESH_DAYS} DAY AND ${VISIBLE_POST} AND d.post_id IS NULL
          AND (s.all_posts = 1 OR EXISTS (SELECT 1 FROM newsletter_books nb WHERE nb.subscriber_id = s.id AND nb.book_id = p.book_id AND nb.created_at <= p.newsletter_at))
        ORDER BY p.newsletter_at, s.id
        LIMIT ?`,
      [left],
    );
    for (const row of due) {
      // Claimed first, so it's never sent twice.
      const [claimed] = await db.execute('INSERT IGNORE INTO newsletter_deliveries (subscriber_id, post_id, sent_at) VALUES (?, ?, UTC_TIMESTAMP())', [row.subscriber_id, row.post_id]);
      if ((claimed as { affectedRows: number }).affectedRows === 0) continue;
      await sendMail(newsletterPostEmail(row.email as string, row.lang as Lang, asNewsletterPost(row), manageUrl(row.token as string), unsubscribeUrl(row.token as string)));
    }
  } catch (err) {
    logError('job', 'newsletter', err);
  }
}
