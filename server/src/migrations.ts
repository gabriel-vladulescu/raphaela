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
];
