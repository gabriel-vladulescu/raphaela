// Each entry runs once, in order; the applied version is recorded in schema_migrations.
// Never edit a migration that has already run; add a new one instead.
export const migrations: string[][] = [
  // 1: Google sign-in (matches the tables created before migrations existed)
  [
    `CREATE TABLE IF NOT EXISTS users (
      id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      google_id     VARCHAR(255) NOT NULL UNIQUE,
      email         VARCHAR(255) NOT NULL,
      name          VARCHAR(255),
      picture       VARCHAR(1024),
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id         CHAR(64) PRIMARY KEY,
      user_id    INT UNSIGNED NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX (expires_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  ],

  // 2: email/password accounts, roles, blog posts, categories, reactions, comments
  [
    `UPDATE users SET email = LOWER(email), name = COALESCE(NULLIF(name, ''), SUBSTRING_INDEX(email, '@', 1))`,
    `ALTER TABLE users
      MODIFY google_id VARCHAR(255) NULL,
      MODIFY name VARCHAR(80) NOT NULL,
      ADD COLUMN password_hash VARCHAR(255) NULL AFTER google_id,
      ADD COLUMN name_confirmed TINYINT(1) NOT NULL DEFAULT 0 AFTER name,
      ADD COLUMN role ENUM('member', 'owner') NOT NULL DEFAULT 'member' AFTER picture,
      ADD UNIQUE INDEX users_email_unique (email)`,
    `CREATE TABLE categories (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      parent_id   INT UNSIGNED NULL,
      name        VARCHAR(80) NOT NULL,
      slug        VARCHAR(100) NOT NULL UNIQUE,
      icon        VARCHAR(16) NULL,
      description VARCHAR(500) NULL,
      position    INT NOT NULL DEFAULT 0,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX (parent_id, position),
      FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE RESTRICT
    )`,
    `CREATE TABLE posts (
      id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      author_id    INT UNSIGNED NOT NULL,
      category_id  INT UNSIGNED NULL,
      title        VARCHAR(200) NOT NULL,
      slug         VARCHAR(220) NOT NULL UNIQUE,
      excerpt      VARCHAR(500) NOT NULL,
      content_html MEDIUMTEXT NOT NULL,
      content_text MEDIUMTEXT NOT NULL,
      reading_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 1,
      banner_url   VARCHAR(500) NULL,
      status       ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
      published_at DATETIME NULL, -- UTC; a future date means "scheduled"
      created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (status, published_at),
      FOREIGN KEY (author_id) REFERENCES users(id),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE post_likes (
      user_id    INT UNSIGNED NOT NULL,
      post_id    INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, post_id),
      INDEX (post_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE post_bookmarks (
      user_id    INT UNSIGNED NOT NULL,
      post_id    INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, post_id),
      INDEX (post_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE comments (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      post_id    INT UNSIGNED NOT NULL,
      user_id    INT UNSIGNED NOT NULL,
      body       TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX (post_id, created_at),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  ],

  // 3: replies (threaded comments) and emoji reactions on comments
  [
    `ALTER TABLE comments
      ADD COLUMN parent_id INT UNSIGNED NULL AFTER user_id,
      ADD INDEX comments_parent (parent_id),
      ADD CONSTRAINT comments_parent_fk FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE`,
    `CREATE TABLE comment_reactions (
      comment_id INT UNSIGNED NOT NULL,
      user_id    INT UNSIGNED NOT NULL,
      emoji      VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (comment_id, user_id, emoji),
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  ],

  // 4: the author role, profile fields, turning comments off per post, comment edits, soft deletes
  [
    `ALTER TABLE users
      MODIFY role ENUM('member', 'author', 'owner') NOT NULL DEFAULT 'member',
      ADD COLUMN avatar_url VARCHAR(500) NULL AFTER picture,
      ADD COLUMN occupation VARCHAR(80) NULL AFTER role,
      ADD COLUMN quote VARCHAR(300) NULL AFTER occupation`,
    `ALTER TABLE posts
      ADD COLUMN comments_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER published_at,
      ADD COLUMN deleted_at DATETIME NULL AFTER updated_at`,
    `ALTER TABLE comments
      ADD COLUMN edited_at DATETIME NULL AFTER created_at,
      ADD COLUMN deleted_at DATETIME NULL AFTER edited_at,
      ADD COLUMN deleted_by INT UNSIGNED NULL AFTER deleted_at,
      ADD CONSTRAINT comments_deleted_by_fk FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL`,
  ],

  // 5: when someone agreed to the Terms and Conditions (on signing up)
  [`ALTER TABLE users ADD COLUMN terms_accepted_at DATETIME NULL AFTER name_confirmed`],

  // 6: likes from guests too, and likes and comment reactions kept when taken back (history); comment threads and
  // edit history; page views and actions for the statistics
  [
    // Post likes: one row per like, from an account or from a guest's browser (the visitor cookie). Taking a like back
    // marks its row (removed_at) instead of deleting it, so the history stays. While a like stands, `liker` is
    // 'u<user id>' or 'v<visitor id>' (NULL once taken back), which allows one live like per person and post. (Not a
    // generated column: MySQL doesn't allow one built from user_id, whose foreign key cascades.)
    `ALTER TABLE post_likes
      DROP PRIMARY KEY,
      ADD COLUMN id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY FIRST,
      MODIFY user_id INT UNSIGNED NULL,
      ADD COLUMN visitor_id CHAR(32) CHARACTER SET ascii NULL AFTER user_id,
      ADD COLUMN fingerprint CHAR(64) CHARACTER SET ascii NULL AFTER visitor_id,
      ADD COLUMN removed_at DATETIME NULL AFTER created_at,
      ADD COLUMN liker VARCHAR(40) CHARACTER SET ascii NULL AFTER removed_at,
      ADD INDEX post_likes_user (user_id),
      ADD INDEX post_likes_visitor (visitor_id)`,
    `UPDATE post_likes SET liker = CONCAT('u', user_id)`,
    `ALTER TABLE post_likes
      ADD UNIQUE INDEX post_likes_live (post_id, liker),
      ADD CONSTRAINT post_likes_liker CHECK ((liker IS NULL) = (removed_at IS NOT NULL) AND (user_id IS NOT NULL OR visitor_id IS NOT NULL))`,

    // Comment reactions: the same, one row per reaction, marked when it's taken back.
    `ALTER TABLE comment_reactions
      DROP PRIMARY KEY,
      ADD COLUMN id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY FIRST,
      ADD COLUMN removed_at DATETIME NULL AFTER created_at,
      ADD COLUMN is_live TINYINT GENERATED ALWAYS AS (IF(removed_at IS NULL, 1, NULL)) STORED,
      ADD UNIQUE INDEX comment_reactions_live (comment_id, user_id, emoji, is_live)`,

    // Comments: the thread each one belongs to (its top-level comment, itself for those) and how deep it sits.
    `ALTER TABLE comments
      ADD COLUMN root_id INT UNSIGNED NULL AFTER parent_id,
      ADD COLUMN depth TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER root_id,
      ADD INDEX comments_thread (post_id, root_id)`,
    `UPDATE comments c
       JOIN (WITH RECURSIVE t AS (
               SELECT id, id AS root_id, 0 AS depth FROM comments WHERE parent_id IS NULL
               UNION ALL
               SELECT m.id, t.root_id, t.depth + 1 FROM comments m JOIN t ON m.parent_id = t.id
             )
             SELECT id, root_id, depth FROM t) x ON x.id = c.id
        SET c.root_id = x.root_id, c.depth = x.depth`,

    // What a comment said before each edit.
    `CREATE TABLE comment_revisions (
      id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      comment_id  INT UNSIGNED NOT NULL,
      body        TEXT NOT NULL,
      replaced_at DATETIME NOT NULL,
      INDEX (comment_id),
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
    )`,

    `ALTER TABLE posts ADD COLUMN view_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER comments_enabled`,

    // Statistics. A visitor is a browser cookie and a fingerprint (a salted hash of IP, browser and language);
    // either one dedupes, so each page view and action is one row per visitor, page and day (in the site's time zone).
    `CREATE TABLE page_views (
      id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      day            DATE NOT NULL,
      path           VARCHAR(255) NOT NULL,
      post_id        INT UNSIGNED NULL,
      visitor_id     CHAR(32) CHARACTER SET ascii NOT NULL,
      fingerprint    CHAR(64) CHARACTER SET ascii NOT NULL,
      user_id        INT UNSIGNED NULL,
      referrer       VARCHAR(255) NULL,
      device         ENUM('mobile', 'tablet', 'desktop') NOT NULL,
      loads          SMALLINT UNSIGNED NOT NULL DEFAULT 1,
      active_seconds INT UNSIGNED NOT NULL DEFAULT 0,
      max_scroll     TINYINT UNSIGNED NOT NULL DEFAULT 0,
      first_at       DATETIME NOT NULL,
      last_at        DATETIME NOT NULL,
      UNIQUE INDEX page_views_visitor (day, path, visitor_id),
      UNIQUE INDEX page_views_fingerprint (day, path, fingerprint),
      INDEX page_views_post (post_id, day),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE events (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      day           DATE NOT NULL,
      action        VARCHAR(40) CHARACTER SET ascii NOT NULL,
      path          VARCHAR(255) NOT NULL,
      post_id       INT UNSIGNED NULL,
      visitor_id    CHAR(32) CHARACTER SET ascii NOT NULL,
      fingerprint   CHAR(64) CHARACTER SET ascii NOT NULL,
      user_id       INT UNSIGNED NULL,
      times         INT UNSIGNED NOT NULL DEFAULT 1,
      first_seconds INT UNSIGNED NULL,
      first_at      DATETIME NOT NULL,
      last_at       DATETIME NOT NULL,
      UNIQUE INDEX events_visitor (day, action, path, visitor_id),
      UNIQUE INDEX events_fingerprint (day, action, path, fingerprint),
      INDEX events_post (post_id, day),
      INDEX events_action (action, day),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,

    // Server-side settings; for now the salt that makes fingerprints unguessable.
    `CREATE TABLE app_settings (
      name  VARCHAR(64) PRIMARY KEY,
      value VARCHAR(255) NOT NULL
    )`,
    `INSERT INTO app_settings (name, value) VALUES ('analytics_salt', HEX(RANDOM_BYTES(32)))`,
  ],

  // 7: series of posts, new-post announcements, notifications for authors, push subscriptions
  [
    // Series: posts that belong together, read in order ("Part 2 of 4").
    `CREATE TABLE series (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      title      VARCHAR(160) NOT NULL,
      slug       VARCHAR(180) NOT NULL UNIQUE,
      author_id  INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    // A post's series and its part in it; when it was announced to readers (new-post notifications). Posts already
    // public aren't announced again.
    `ALTER TABLE posts
      ADD COLUMN series_id INT UNSIGNED NULL AFTER category_id,
      ADD COLUMN series_part SMALLINT UNSIGNED NULL AFTER series_id,
      ADD COLUMN announced_at DATETIME NULL AFTER view_count,
      ADD INDEX posts_series (series_id, series_part),
      ADD CONSTRAINT posts_series_fk FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE SET NULL`,
    `UPDATE posts SET announced_at = UTC_TIMESTAMP() WHERE status = 'published' AND published_at <= UTC_TIMESTAMP()`,

    // Notifications for a post's author: comments and replies, likes, shares, view milestones. Likes and shares on a
    // post are grouped while unread ("Ana and 3 others"): \`times\` counts them, \`actor_id\` is the latest one (NULL: a
    // guest). \`detail\`: the app a post was shared to. \`value\`: the milestone reached.
    `CREATE TABLE notifications (
      id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id    INT UNSIGNED NOT NULL,
      type       ENUM('comment', 'reply', 'like', 'share', 'views') NOT NULL,
      post_id    INT UNSIGNED NULL,
      comment_id INT UNSIGNED NULL,
      actor_id   INT UNSIGNED NULL,
      times      INT UNSIGNED NOT NULL DEFAULT 1,
      detail     VARCHAR(40) NULL,
      value      INT UNSIGNED NULL,
      created_at DATETIME NOT NULL,
      read_at    DATETIME NULL,
      INDEX notifications_user (user_id, id),
      INDEX notifications_unread (user_id, read_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
    )`,

    // Devices that get push notifications: new posts (anyone), and an author's notifications (\`activity\`, signed in).
    // Endpoints are long URLs, so they're unique by their hash.
    `CREATE TABLE push_subscriptions (
      id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      endpoint      VARCHAR(1000) NOT NULL,
      endpoint_hash CHAR(64) CHARACTER SET ascii NOT NULL UNIQUE,
      p256dh        VARCHAR(255) NOT NULL,
      auth          VARCHAR(100) NOT NULL,
      user_id       INT UNSIGNED NULL,
      visitor_id    CHAR(32) CHARACTER SET ascii NULL,
      new_posts     TINYINT(1) NOT NULL DEFAULT 0,
      activity      TINYINT(1) NOT NULL DEFAULT 0,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_sent_at  DATETIME NULL,
      INDEX (user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  ],

  // 8: the notifications page's paging (newest first, by time) and its date filter
  [`CREATE INDEX notifications_user_time ON notifications (user_id, created_at, id)`],

  // 9: support tickets (the contact form; attachments kept in the database, never public), notifications for
  // members too (new posts, replies and reactions to their comments), milestones, and each account's choices of
  // what to be notified of (notify_settings; null: the defaults)
  [
    `CREATE TABLE support_tickets (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id    INT UNSIGNED NULL,
      visitor_id CHAR(32) CHARACTER SET ascii NULL,
      name       VARCHAR(100) NULL,
      email      VARCHAR(190) NOT NULL,
      category   ENUM('account', 'content', 'technical', 'other') NOT NULL DEFAULT 'other',
      title      VARCHAR(160) NOT NULL,
      body       TEXT NOT NULL,
      created_at DATETIME NOT NULL,
      seen_at    DATETIME NULL,
      INDEX support_tickets_time (created_at, id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE support_attachments (
      id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      ticket_id INT UNSIGNED NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      mime      VARCHAR(100) NOT NULL,
      size      INT UNSIGNED NOT NULL,
      data      MEDIUMBLOB NOT NULL,
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
    )`,
    `ALTER TABLE notifications
      MODIFY type ENUM('comment', 'reply', 'like', 'share', 'views', 'new_post', 'comment_reply', 'comment_reaction',
                       'post_reaction', 'milestone', 'support') NOT NULL,
      ADD COLUMN ticket_id INT UNSIGNED NULL AFTER comment_id,
      ADD CONSTRAINT notifications_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE`,
    `ALTER TABLE users ADD COLUMN notify_settings JSON NULL`,
  ],

  // 10: usernames, for the addresses /{username}/articole and /{username}/articole-salvate (made from the name for
  // existing accounts at start-up, lib/usernames.ts), and whether those two lists are public
  [
    `ALTER TABLE users
      ADD COLUMN username VARCHAR(30) CHARACTER SET ascii NULL AFTER name,
      ADD UNIQUE INDEX users_username (username),
      ADD COLUMN public_articles TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN public_saved TINYINT(1) NOT NULL DEFAULT 0`,
  ],

  // 11: usernames join their words with dots (they had hyphens: victor-solaris -> victor.solaris), and the Google
  // account a signed-in person picked to connect, kept with their session until they confirm it (it changes their
  // email, routes/me.ts)
  [
    `UPDATE users SET username = REPLACE(username, '-', '.') WHERE username LIKE '%-%'`,
    `ALTER TABLE sessions ADD COLUMN google_link JSON NULL`,
  ],

  // 12: confirmed emails, deleted accounts (kept 3 months, then anonymised: purged_at), suspensions, reported
  // comments, the links sent by email, and longer settings (the SMTP server's, as JSON)
  [
    `ALTER TABLE users
      ADD COLUMN email_verified_at DATETIME NULL AFTER email,
      ADD COLUMN deleted_at DATETIME NULL,
      ADD COLUMN purged_at DATETIME NULL,
      ADD COLUMN suspended_at DATETIME NULL,
      ADD COLUMN suspended_until DATETIME NULL,
      ADD COLUMN suspension_reason VARCHAR(500) NULL,
      ADD COLUMN suspended_by INT UNSIGNED NULL,
      ADD INDEX users_deleted (deleted_at),
      ADD CONSTRAINT users_suspended_by FOREIGN KEY (suspended_by) REFERENCES users(id) ON DELETE SET NULL`,
    // Google proved these addresses; the seed's (@seed.local) can't receive mail, so they count as confirmed too.
    `UPDATE users SET email_verified_at = created_at WHERE google_id IS NOT NULL OR email LIKE '%@seed.local'`,
    // A link sent by email: confirm the address (verify), a new password (reset), a new address (change, to `email`).
    // Only its hash is kept; it's deleted once used.
    `CREATE TABLE email_tokens (
      id         CHAR(64) CHARACTER SET ascii PRIMARY KEY,
      user_id    INT UNSIGNED NOT NULL,
      purpose    ENUM('verify', 'reset', 'change') NOT NULL,
      email      VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL,
      INDEX email_tokens_user (user_id, purpose),
      INDEX (expires_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    // One open report per person and comment; resolved ones stay as history (kept: the comment stays; removed: it was deleted).
    `CREATE TABLE comment_reports (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      comment_id  INT UNSIGNED NOT NULL,
      reporter_id INT UNSIGNED NULL,
      reason      ENUM('spam', 'harassment', 'hate', 'inappropriate', 'other') NOT NULL,
      details     VARCHAR(500) NULL,
      created_at  DATETIME NOT NULL,
      resolved_at DATETIME NULL,
      resolved_by INT UNSIGNED NULL,
      resolution  ENUM('kept', 'removed') NULL,
      is_open     TINYINT GENERATED ALWAYS AS (IF(resolved_at IS NULL, 1, NULL)) STORED,
      UNIQUE INDEX comment_reports_open (comment_id, reporter_id, is_open),
      INDEX comment_reports_queue (resolved_at, created_at),
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `ALTER TABLE app_settings MODIFY value TEXT NOT NULL`,
  ],

  // 13: what a person chose when deleting their account (their comments, an author's posts: kept or deleted), the
  // comments and posts its deletion took away (restored with the account, gone for good with it), and administrators'
  // notifications about reported comments and accounts waiting to be deleted for good (account_id)
  [
    `ALTER TABLE users
      ADD COLUMN deletion_comments ENUM('keep', 'delete') NULL AFTER deleted_at,
      ADD COLUMN deletion_posts ENUM('keep', 'delete') NULL AFTER deletion_comments,
      ADD COLUMN deletion_due_notified_at DATETIME NULL AFTER deletion_posts`,
    `ALTER TABLE comments
      ADD COLUMN deleted_with_account INT UNSIGNED NULL AFTER deleted_by,
      ADD INDEX comments_deleted_with_account (deleted_with_account)`,
    `ALTER TABLE posts
      ADD COLUMN deleted_with_account INT UNSIGNED NULL AFTER deleted_at,
      ADD INDEX posts_deleted_with_account (deleted_with_account)`,
    // Accounts deleted before the choice existed kept their comments and posts.
    `UPDATE users SET deletion_comments = 'keep', deletion_posts = IF(role = 'author', 'keep', NULL) WHERE deleted_at IS NOT NULL`,
    `ALTER TABLE notifications
      MODIFY type ENUM('comment', 'reply', 'like', 'share', 'views', 'new_post', 'comment_reply', 'comment_reaction',
                       'post_reaction', 'milestone', 'support', 'report', 'account_due') NOT NULL,
      ADD COLUMN account_id INT UNSIGNED NULL AFTER ticket_id,
      ADD CONSTRAINT notifications_account FOREIGN KEY (account_id) REFERENCES users(id) ON DELETE CASCADE`,
  ],

  // 14: every email the site tried to send and how it went (the admin panel's history; SMTP servers limit how many a
  // day), and what administrators did (who changed what, and when)
  [
    `CREATE TABLE email_log (
      id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      created_at DATETIME NOT NULL,
      to_email   VARCHAR(255) NOT NULL,
      kind       VARCHAR(30) CHARACTER SET ascii NOT NULL,
      subject    VARCHAR(255) NOT NULL,
      status     ENUM('sent', 'failed', 'logged') NOT NULL,
      error      VARCHAR(1000) NULL,
      INDEX email_log_time (created_at),
      INDEX email_log_status (status, created_at),
      INDEX email_log_to (to_email)
    )`,
    `CREATE TABLE admin_log (
      id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      created_at   DATETIME NOT NULL,
      admin_id     INT UNSIGNED NULL,
      admin_name   VARCHAR(80) NOT NULL,
      action       VARCHAR(40) CHARACTER SET ascii NOT NULL,
      target_type  VARCHAR(20) CHARACTER SET ascii NOT NULL,
      target_id    INT UNSIGNED NULL,
      target_label VARCHAR(255) NOT NULL,
      details      JSON NULL,
      INDEX admin_log_time (created_at, id),
      INDEX admin_log_target (target_type, target_id),
      INDEX admin_log_admin (admin_id, created_at),
      FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
  ],

  // 15: the blog as a base for others. Posts: old addresses that lead to them, search and share fields, tags, saved
  // versions, a secret preview link, featured on the home page, when the newsletter announced them. Comments waiting
  // for approval. Following authors. The newsletter (subscribers, what each got). Invitations to become an author.
  // What readers search for (counted per day, nothing about who).
  [
    `CREATE TABLE post_redirects (
      old_slug   VARCHAR(220) PRIMARY KEY,
      post_id    INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL,
      INDEX (post_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`,
    `ALTER TABLE posts
      ADD COLUMN seo_title VARCHAR(200) NULL AFTER excerpt,
      ADD COLUMN seo_description VARCHAR(300) NULL AFTER seo_title,
      ADD COLUMN social_image_url VARCHAR(500) NULL AFTER banner_url,
      ADD COLUMN preview_token CHAR(32) CHARACTER SET ascii NULL,
      ADD COLUMN featured_at DATETIME NULL,
      ADD COLUMN newsletter_at DATETIME NULL,
      ADD UNIQUE INDEX posts_preview (preview_token),
      ADD INDEX posts_featured (featured_at)`,
    // Posts already public aren't sent to subscribers who join later.
    `UPDATE posts SET newsletter_at = UTC_TIMESTAMP() WHERE status = 'published' AND published_at <= UTC_TIMESTAMP()`,
    `CREATE TABLE tags (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(60) NOT NULL,
      slug       VARCHAR(80) NOT NULL UNIQUE,
      created_at DATETIME NOT NULL
    )`,
    `CREATE TABLE post_tags (
      post_id INT UNSIGNED NOT NULL,
      tag_id  INT UNSIGNED NOT NULL,
      PRIMARY KEY (post_id, tag_id),
      INDEX (tag_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE post_revisions (
      id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      post_id      INT UNSIGNED NOT NULL,
      saved_at     DATETIME NOT NULL,
      saved_by     INT UNSIGNED NULL,
      title        VARCHAR(200) NOT NULL,
      excerpt      VARCHAR(500) NOT NULL,
      content_html MEDIUMTEXT NOT NULL,
      banner_url   VARCHAR(500) NULL,
      INDEX post_revisions_post (post_id, saved_at),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (saved_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `ALTER TABLE comments
      ADD COLUMN held_at DATETIME NULL AFTER deleted_with_account,
      ADD COLUMN held_reason VARCHAR(40) CHARACTER SET ascii NULL AFTER held_at,
      ADD INDEX comments_held (held_at)`,
    `CREATE TABLE author_follows (
      user_id    INT UNSIGNED NOT NULL,
      author_id  INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL,
      PRIMARY KEY (user_id, author_id),
      INDEX (author_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE newsletter_subscribers (
      id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      email           VARCHAR(255) NOT NULL UNIQUE,
      user_id         INT UNSIGNED NULL,
      frequency       ENUM('instant', 'weekly') NOT NULL DEFAULT 'instant',
      lang            ENUM('ro', 'en') NOT NULL DEFAULT 'ro',
      token           CHAR(43) CHARACTER SET ascii NOT NULL UNIQUE,
      created_at      DATETIME NOT NULL,
      confirmed_at    DATETIME NULL,
      unsubscribed_at DATETIME NULL,
      last_digest_at  DATETIME NULL,
      INDEX newsletter_active (confirmed_at, unsubscribed_at, frequency),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE newsletter_deliveries (
      subscriber_id INT UNSIGNED NOT NULL,
      post_id       INT UNSIGNED NOT NULL,
      sent_at       DATETIME NOT NULL,
      PRIMARY KEY (subscriber_id, post_id),
      INDEX (post_id),
      FOREIGN KEY (subscriber_id) REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE invites (
      id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      token_hash       CHAR(64) CHARACTER SET ascii NOT NULL UNIQUE,
      email            VARCHAR(255) NOT NULL,
      role             ENUM('author') NOT NULL DEFAULT 'author',
      message          VARCHAR(500) NULL,
      invited_by       INT UNSIGNED NULL,
      created_at       DATETIME NOT NULL,
      expires_at       DATETIME NOT NULL,
      accepted_at      DATETIME NULL,
      accepted_user_id INT UNSIGNED NULL,
      revoked_at       DATETIME NULL,
      INDEX (email),
      FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (accepted_user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE search_log (
      day      DATE NOT NULL,
      query    VARCHAR(100) NOT NULL,
      searches INT UNSIGNED NOT NULL DEFAULT 0,
      no_results INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (day, query)
    )`,
    `ALTER TABLE notifications
      MODIFY type ENUM('comment', 'reply', 'like', 'share', 'views', 'new_post', 'comment_reply', 'comment_reaction',
                       'post_reaction', 'milestone', 'support', 'report', 'account_due', 'comment_held', 'mention',
                       'followed_post') NOT NULL`,
  ],
  // 16: a banner's credit (an image from a library: who made it, its licence) and where it comes from.
  [
    `ALTER TABLE posts
      ADD COLUMN banner_credit VARCHAR(300) NULL AFTER banner_url,
      ADD COLUMN banner_credit_url VARCHAR(500) NULL AFTER banner_credit`,
  ],
  // 17: administrators hear when data is past the time the Terms promise to keep it (they delete it themselves).
  [
    `ALTER TABLE notifications
      MODIFY type ENUM('comment', 'reply', 'like', 'share', 'views', 'new_post', 'comment_reply', 'comment_reaction',
                       'post_reaction', 'milestone', 'support', 'report', 'account_due', 'comment_held', 'mention',
                       'followed_post', 'cleanup_due') NOT NULL`,
  ],
  // 18: links sent by email aren't deleted when they stop working: a used one is marked used, and one that stopped
  // before (a newer one, the password or the address changed, the account was deleted...) says why. The records go
  // when an administrator deletes old data (lib/retention.ts).
  [
    `ALTER TABLE email_tokens
      ADD COLUMN used_at DATETIME NULL AFTER expires_at,
      ADD COLUMN revoked_at DATETIME NULL AFTER used_at,
      ADD COLUMN revoked_reason ENUM('replaced', 'password_changed', 'address_changed', 'verified', 'cancelled', 'google',
                                     'account_deleted') NULL AFTER revoked_at,
      ADD INDEX email_tokens_time (created_at)`,
  ],
  // 19: sign-ins that end (signing out, a new password, a suspension...) are kept as a record, with why; and an
  // account keeps the history of its address, name and username (kept with the account).
  [
    `ALTER TABLE sessions
      ADD COLUMN ended_at DATETIME NULL AFTER expires_at,
      ADD COLUMN end_reason ENUM('signed_out', 'password_changed', 'password_reset', 'google', 'suspended', 'account_deleted') NULL AFTER ended_at`,
    `CREATE TABLE account_changes (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id    INT UNSIGNED NOT NULL,
      field      ENUM('email', 'name', 'username') NOT NULL,
      old_value  VARCHAR(255) NULL,
      new_value  VARCHAR(255) NULL,
      via        ENUM('profile', 'email_link', 'google', 'admin') NOT NULL,
      changed_at DATETIME NOT NULL,
      INDEX account_changes_user (user_id, changed_at),
      INDEX account_changes_old (old_value),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  ],
  // 20: books. A book is read chapter by chapter: each chapter is a post (same editor, comments, likes, statistics)
  // with the book and its number. A book has one subject (a category), a cover drawn from a design (layout, ornament,
  // colours: client/src/lib/covers.ts) and is on the site once one of its chapters is. Saved cover designs are shared
  // by the writers. Signed-in readers' progress in each post (guests keep theirs in the browser) and the days they
  // read, for "continue reading" and the streak; kept as long as the account (deleted with it).
  [
    `CREATE TABLE books (
      id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      author_id        INT UNSIGNED NOT NULL,
      category_id      INT UNSIGNED NULL,
      title            VARCHAR(160) NOT NULL,
      slug             VARCHAR(180) NOT NULL UNIQUE,
      description      VARCHAR(1000) NOT NULL DEFAULT '',
      cover            JSON NOT NULL,
      planned_chapters SMALLINT UNSIGNED NULL,
      completed_at     DATETIME NULL,
      created_at       DATETIME NOT NULL,
      updated_at       DATETIME NOT NULL,
      deleted_at       DATETIME NULL,
      INDEX books_author (author_id),
      INDEX books_category (category_id),
      FOREIGN KEY (author_id) REFERENCES users(id),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    )`,
    `ALTER TABLE posts
      ADD COLUMN book_id INT UNSIGNED NULL AFTER series_part,
      ADD COLUMN chapter_no SMALLINT UNSIGNED NULL AFTER book_id,
      ADD INDEX posts_book (book_id, chapter_no),
      ADD CONSTRAINT posts_book_fk FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL`,
    `CREATE TABLE cover_templates (
      id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(40) NOT NULL,
      design     JSON NOT NULL,
      created_by INT UNSIGNED NULL,
      created_at DATETIME NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE reading_progress (
      user_id     INT UNSIGNED NOT NULL,
      post_id     INT UNSIGNED NOT NULL,
      progress    TINYINT UNSIGNED NOT NULL,
      updated_at  DATETIME NOT NULL,
      finished_at DATETIME NULL,
      PRIMARY KEY (user_id, post_id),
      INDEX reading_recent (user_id, updated_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE reading_days (
      user_id INT UNSIGNED NOT NULL,
      day     DATE NOT NULL,
      PRIMARY KEY (user_id, day),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
  ],
  // 21: chapters and posts apart (still one table: comments, likes, views and the rest are the same for both). A
  // chapter always has a book and a number, and no category (its book has one); a post has no book. A book can't be
  // removed from under its chapters (they'd turn into posts). Series are gone: the books took their place.
  [
    'UPDATE posts SET category_id = NULL WHERE book_id IS NOT NULL',
    'ALTER TABLE posts DROP FOREIGN KEY posts_book_fk',
    'ALTER TABLE posts ADD CONSTRAINT posts_book_fk FOREIGN KEY (book_id) REFERENCES books(id)',
    'ALTER TABLE posts DROP FOREIGN KEY posts_series_fk',
    'ALTER TABLE posts DROP INDEX posts_series, DROP COLUMN series_id, DROP COLUMN series_part',
    'DROP TABLE series',
  ],
  // 22: a book is published or not, by its author: unpublished, it and its chapters are hidden from readers (its author
  // and administrators still see them). The books there were stay as they were: published.
  [
    'ALTER TABLE books ADD COLUMN published_at DATETIME NULL AFTER completed_at',
    'UPDATE books SET published_at = created_at',
  ],
  // 23: a tag can have a colour and a sign (tagStyles.ts), and its name a shape: lower case, the words joined by
  // dashes ("Full Moon" -> "full-moon"). The tags there were take it (their addresses, the slugs, stay).
  [
    'ALTER TABLE tags ADD COLUMN color VARCHAR(16) NULL AFTER slug, ADD COLUMN icon VARCHAR(16) NULL AFTER color',
    `UPDATE tags SET name = TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER(name), '[^[:alnum:]]+', '-'))`,
    `UPDATE tags SET name = TRIM(TRAILING '-' FROM LEFT(name, 40))`,
    `UPDATE tags SET name = slug WHERE name = ''`,
  ],
  // 24: a person's books can be public too (/{username}/carti, as their journal and saved posts: Settings), and a
  // comment's thread start (root_id) is a real relation, going with it as its parent does.
  [
    'ALTER TABLE users ADD COLUMN public_books TINYINT(1) NOT NULL DEFAULT 0 AFTER public_articles',
    'ALTER TABLE comments ADD CONSTRAINT comments_root_fk FOREIGN KEY (root_id) REFERENCES comments(id) ON DELETE CASCADE',
  ],
  // 25: the newsletter has no frequency (each new post by email, when it's out; no weekly digest), and it can be for
  // some books only: "Notify me" at the end of an unfinished book, by email (newsletter_books) or on a device
  // (push_books). An address gets every new post (all_posts), the chapters of its books, or both.
  [
    `ALTER TABLE newsletter_subscribers
      DROP INDEX newsletter_active,
      DROP COLUMN frequency,
      DROP COLUMN last_digest_at,
      ADD COLUMN all_posts TINYINT(1) NOT NULL DEFAULT 1 AFTER lang,
      ADD INDEX newsletter_active (confirmed_at, unsubscribed_at)`,
    `CREATE TABLE newsletter_books (
      subscriber_id INT UNSIGNED NOT NULL,
      book_id       INT UNSIGNED NOT NULL,
      created_at    DATETIME NOT NULL,
      PRIMARY KEY (subscriber_id, book_id),
      INDEX (book_id),
      FOREIGN KEY (subscriber_id) REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE push_books (
      subscription_id INT UNSIGNED NOT NULL,
      book_id         INT UNSIGNED NOT NULL,
      created_at      DATETIME NOT NULL,
      PRIMARY KEY (subscription_id, book_id),
      INDEX (book_id),
      FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    )`,
  ],
  // 26: what the site did and what went wrong, for the admin panel's logs. The server's errors (a failed request, a
  // background job, a push the push service refused), the same one counted up while it repeats. Each push sent (to
  // how many devices, how many got it). Each sign-in attempt, with how it went and the browser (never the IP
  // address); sign-ins remember their browser too, and can be ended by an administrator. Devices with push say which
  // browser they are. Support tickets become conversations: a state, and replies (an administrator's go out by email,
  // and into the app when the ticket was sent signed in; the sender answers from the app).
  [
    `CREATE TABLE error_log (
      id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      created_at DATETIME NOT NULL,
      last_at    DATETIME NOT NULL,
      times      INT UNSIGNED NOT NULL DEFAULT 1,
      source     VARCHAR(20) CHARACTER SET ascii NOT NULL,
      context    VARCHAR(255) NOT NULL DEFAULT '',
      message    VARCHAR(500) NOT NULL,
      detail     TEXT NULL,
      user_id    INT UNSIGNED NULL,
      seen_at    DATETIME NULL,
      INDEX error_log_time (created_at, id),
      INDEX error_log_last (last_at),
      INDEX error_log_same (source, last_at),
      INDEX error_log_unseen (seen_at)
    )`,
    `CREATE TABLE push_log (
      id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      created_at DATETIME NOT NULL,
      kind       VARCHAR(30) CHARACTER SET ascii NOT NULL,
      title      VARCHAR(255) NOT NULL,
      url        VARCHAR(500) NULL,
      user_id    INT UNSIGNED NULL,
      devices    INT UNSIGNED NOT NULL,
      sent       INT UNSIGNED NOT NULL,
      failed     INT UNSIGNED NOT NULL,
      gone       INT UNSIGNED NOT NULL,
      error      VARCHAR(500) NULL,
      INDEX push_log_time (created_at, id),
      INDEX push_log_user (user_id, created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `CREATE TABLE auth_log (
      id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      created_at DATETIME NOT NULL,
      user_id    INT UNSIGNED NULL,
      email      VARCHAR(190) NULL,
      method     ENUM('password', 'google', 'signup', 'reset', 'invite') NOT NULL,
      outcome    ENUM('ok', 'wrong_password', 'unknown_email', 'google_only', 'suspended', 'deleted', 'failed') NOT NULL,
      device     VARCHAR(80) NULL,
      INDEX auth_log_time (created_at, id),
      INDEX auth_log_user (user_id, created_at),
      INDEX auth_log_email (email, created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `ALTER TABLE sessions
      ADD COLUMN device VARCHAR(80) NULL AFTER created_at,
      MODIFY end_reason ENUM('signed_out', 'password_changed', 'password_reset', 'google', 'suspended', 'account_deleted', 'admin') NULL`,
    'ALTER TABLE push_subscriptions ADD COLUMN device VARCHAR(80) NULL AFTER visitor_id',
    `ALTER TABLE support_tickets
      ADD COLUMN status ENUM('open', 'answered', 'closed') NOT NULL DEFAULT 'open' AFTER body,
      ADD COLUMN updated_at DATETIME NULL AFTER created_at,
      ADD INDEX support_tickets_user (user_id, created_at),
      ADD INDEX support_tickets_status (status, created_at)`,
    'UPDATE support_tickets SET updated_at = created_at',
    `CREATE TABLE support_replies (
      id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      ticket_id   INT UNSIGNED NOT NULL,
      author_id   INT UNSIGNED NULL,
      author_name VARCHAR(80) NOT NULL,
      staff       TINYINT(1) NOT NULL,
      body        TEXT NOT NULL,
      created_at  DATETIME NOT NULL,
      emailed     TINYINT(1) NOT NULL DEFAULT 0,
      INDEX support_replies_ticket (ticket_id, created_at),
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
    )`,
    `ALTER TABLE notifications
      MODIFY type ENUM('comment', 'reply', 'like', 'share', 'views', 'new_post', 'comment_reply', 'comment_reaction',
                       'post_reaction', 'milestone', 'support', 'report', 'account_due', 'comment_held', 'mention',
                       'followed_post', 'cleanup_due', 'support_reply') NOT NULL`,
  ],
  // 27: an email goes out only through an SMTP server, in development too (no more "written to the server's log"). What
  // was only logged never went out: it failed, and the support answers it carried weren't emailed.
  [
    `UPDATE support_replies r
        JOIN support_tickets t ON t.id = r.ticket_id
        SET r.emailed = 0
      WHERE r.staff = 1 AND EXISTS (
        SELECT 1 FROM email_log e
         WHERE e.status = 'logged' AND e.kind = 'support_reply' AND e.to_email = t.email
           AND e.created_at BETWEEN r.created_at - INTERVAL 1 MINUTE AND r.created_at + INTERVAL 1 MINUTE)`,
    "UPDATE email_log SET status = 'failed', error = 'Niciun server SMTP setat' WHERE status = 'logged'",
    "ALTER TABLE email_log MODIFY status ENUM('sent', 'failed') NOT NULL",
  ],
];
