import type { Pool, RowDataPacket } from 'mysql2/promise';

// Everything the site keeps about an account, for its person to download (GDPR: access and portability). The same
// list as the Terms' "what we keep" (client/src/pages/termsContent.ts).

const rows = async (db: Pool, sql: string, params: unknown[]) => (await db.query<RowDataPacket[]>(sql, params))[0];
/** Columns made with JSON_ARRAYAGG, as lists: MySQL hands them over parsed, MariaDB as text. */
const withLists = (list: RowDataPacket[], ...columns: string[]) =>
  list.map((row) => {
    for (const column of columns) if (typeof row[column] === 'string') row[column] = JSON.parse(row[column] as string);
    return row;
  });

export async function exportAccount(db: Pool, userId: number) {
  const [account] = await rows(
    db,
    `SELECT id, email, email_verified_at, name, username, picture, avatar_url, role, occupation, quote, created_at, last_login_at,
            terms_accepted_at, google_id IS NOT NULL AS google_connected, password_hash IS NOT NULL AS has_password,
            public_articles, public_books, public_saved, notify_settings
       FROM users WHERE id = ?`,
    [userId],
  );
  return {
    exportedAt: new Date().toISOString(),
    account: account
      ? {
          ...account,
          google_connected: Boolean(account.google_connected),
          has_password: Boolean(account.has_password),
          public_articles: Boolean(account.public_articles),
          public_books: Boolean(account.public_books),
          public_saved: Boolean(account.public_saved),
          notify_settings: typeof account.notify_settings === 'string' ? JSON.parse(account.notify_settings) : account.notify_settings,
        }
      : null,
    comments: withLists(
      await rows(
        db,
        `SELECT m.id, m.parent_id, p.title AS post, p.slug AS post_slug, m.body, m.created_at, m.edited_at, m.deleted_at,
                (SELECT JSON_ARRAYAGG(JSON_OBJECT('body', r.body, 'replaced_at', r.replaced_at)) FROM comment_revisions r WHERE r.comment_id = m.id) AS earlier_versions
           FROM comments m JOIN posts p ON p.id = m.post_id WHERE m.user_id = ? ORDER BY m.created_at`,
        [userId],
      ),
      'earlier_versions',
    ),
    commentReactions: await rows(
      db,
      'SELECT r.comment_id, r.emoji, r.created_at, r.removed_at FROM comment_reactions r WHERE r.user_id = ? ORDER BY r.created_at',
      [userId],
    ),
    likes: await rows(
      db,
      'SELECT p.title AS post, p.slug AS post_slug, l.created_at, l.removed_at FROM post_likes l JOIN posts p ON p.id = l.post_id WHERE l.user_id = ? ORDER BY l.created_at',
      [userId],
    ),
    savedPosts: await rows(
      db,
      'SELECT p.title AS post, p.slug AS post_slug, b.created_at FROM post_bookmarks b JOIN posts p ON p.id = b.post_id WHERE b.user_id = ? ORDER BY b.created_at',
      [userId],
    ),
    posts: await rows(
      db,
      'SELECT id, title, slug, status, published_at, created_at, updated_at, deleted_at FROM posts WHERE author_id = ? ORDER BY created_at',
      [userId],
    ),
    books: await rows(
      db,
      'SELECT id, title, slug, description, planned_chapters, completed_at, created_at, updated_at, deleted_at FROM books WHERE author_id = ? ORDER BY created_at',
      [userId],
    ),
    readingProgress: await rows(
      db,
      'SELECT p.title AS post, p.slug AS post_slug, r.progress, r.updated_at, r.finished_at FROM reading_progress r JOIN posts p ON p.id = r.post_id WHERE r.user_id = ? ORDER BY r.updated_at',
      [userId],
    ),
    readingDays: await rows(db, 'SELECT day FROM reading_days WHERE user_id = ? ORDER BY day', [userId]),
    reportsSent: await rows(
      db,
      'SELECT comment_id, reason, details, created_at, resolved_at, resolution FROM comment_reports WHERE reporter_id = ? ORDER BY created_at',
      [userId],
    ),
    supportTickets: withLists(
      await rows(
        db,
        `SELECT t.id, t.email, t.name, t.category, t.title, t.body, t.status, t.created_at,
                (SELECT JSON_ARRAYAGG(a.file_name) FROM support_attachments a WHERE a.ticket_id = t.id) AS attachments,
                (SELECT JSON_ARRAYAGG(JSON_OBJECT('from', IF(r.staff, 'support', 'you'), 'body', r.body, 'created_at', r.created_at))
                   FROM support_replies r WHERE r.ticket_id = t.id) AS replies
           FROM support_tickets t WHERE t.user_id = ? ORDER BY t.created_at`,
        [userId],
      ),
      'attachments',
      'replies',
    ),
    notifications: await rows(db, 'SELECT type, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at', [userId]),
    pushDevices: await rows(db, 'SELECT device, created_at, last_sent_at, new_posts, activity FROM push_subscriptions WHERE user_id = ?', [userId]),
    sessions: await rows(db, 'SELECT created_at, device, expires_at, ended_at, end_reason FROM sessions WHERE user_id = ? ORDER BY created_at', [userId]),
    // Each sign-in attempt on the account: how, how it went, the browser.
    signInAttempts: await rows(db, 'SELECT created_at, email, method, outcome, device FROM auth_log WHERE user_id = ? ORDER BY created_at', [userId]),
    // Earlier addresses, names and usernames.
    accountChanges: await rows(db, 'SELECT field, old_value, new_value, via, changed_at FROM account_changes WHERE user_id = ? ORDER BY changed_at', [userId]),
    // Links sent by email (to confirm the address, a new password, a new address) and what became of them.
    emailLinks: await rows(
      db,
      'SELECT purpose, email, created_at, expires_at, used_at, revoked_at, revoked_reason FROM email_tokens WHERE user_id = ? ORDER BY created_at',
      [userId],
    ),
    following: await rows(
      db,
      'SELECT u.name AS author, u.username, f.created_at FROM author_follows f JOIN users u ON u.id = f.author_id WHERE f.user_id = ? ORDER BY f.created_at',
      [userId],
    ),
    newsletter: await rows(
      db,
      `SELECT s.email, s.all_posts, (SELECT GROUP_CONCAT(bk.title ORDER BY nb.created_at SEPARATOR ' · ') FROM newsletter_books nb JOIN books bk ON bk.id = nb.book_id WHERE nb.subscriber_id = s.id) AS books, s.lang, s.created_at, s.confirmed_at, s.unsubscribed_at,
              (SELECT COUNT(*) FROM newsletter_deliveries d WHERE d.subscriber_id = s.id) AS emails_received
         FROM newsletter_subscribers s WHERE s.user_id = ? OR s.email = (SELECT email FROM users WHERE id = ?)`,
      [userId, userId],
    ),
    // Statistics recorded while signed in (with consent): pages read, how long, and actions.
    pageViews: await rows(
      db,
      'SELECT day, path, referrer, device, loads, active_seconds, max_scroll FROM page_views WHERE user_id = ? ORDER BY day, id',
      [userId],
    ),
    actions: await rows(db, 'SELECT day, action, path, times FROM events WHERE user_id = ? ORDER BY day, id', [userId]),
  };
}
