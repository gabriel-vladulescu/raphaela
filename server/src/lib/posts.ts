import type { Pool, RowDataPacket } from 'mysql2/promise';
import { makeExcerpt } from '@/lib/sanitize';
import type { SessionUser } from '@/lib/session';
import { bookOfChapter } from '@/lib/books';
import { tagsOf } from '@/lib/tags';
import { shareImagePath } from '@/seo/og';

/** How much of a post's text stands in for its summary when the author didn't write one (home page, search results,
 *  link previews, the feed). */
export const SUMMARY_LENGTH = 160;
/** SQL (on alias `p`) for the start of the text: enough to make that summary from, without loading all of it. */
export const TEXT_START = `LEFT(p.content_text, ${SUMMARY_LENGTH * 2}) AS text_start`;

/** The summary the author wrote, or else the start of the text, cut at a word (the row needs `excerpt` and TEXT_START). */
export function summaryOf(row: RowDataPacket) {
  return String(row.excerpt ?? '').trim() || makeExcerpt(String(row.text_start ?? '').trim(), SUMMARY_LENGTH);
}

// Posts and chapters are one table (comments, likes, views, notifications and the rest work the same for both), but
// two things: a post (the journal's articles) has no book; a chapter has one, a number in it, and no category.

/** SQL conditions (on alias `p`): a post, a chapter. */
export const IS_POST = 'p.book_id IS NULL';
export const IS_CHAPTER = 'p.book_id IS NOT NULL';

export type Kind = 'post' | 'chapter';
export const kindCondition = (kind: Kind) => (kind === 'chapter' ? IS_CHAPTER : IS_POST);

/** Where it's read: /posts/{slug}, or a chapter under its book, /carti/{book}/{slug}. */
export const postPath = (slug: string, bookSlug?: string | null) =>
  bookSlug ? `/carti/${encodeURIComponent(bookSlug)}/${encodeURIComponent(slug)}` : `/posts/${encodeURIComponent(slug)}`;

/** SQL condition (on alias `p`): the post itself is out: published, not scheduled for later, not deleted (a deleted
 *  account's posts too, when its author chose so: lib/accounts.ts). */
export const PUBLISHED_POST = `p.deleted_at IS NULL AND p.status = 'published' AND p.published_at <= UTC_TIMESTAMP()`;

/** SQL condition (on alias `p`) for posts the public can see: out (PUBLISHED_POST), and a chapter's book published too
 *  (an unpublished book hides its chapters). */
export const VISIBLE_POST = `${PUBLISHED_POST} AND (p.book_id IS NULL OR EXISTS (SELECT 1 FROM books vb WHERE vb.id = p.book_id AND vb.published_at IS NOT NULL))`;

/**
 * Posts a viewer may open: owners see everything (deleted posts too), authors also their own drafts and
 * scheduled posts, everyone else what the public sees.
 */
export function visibleTo(user: SessionUser | null): string {
  if (user?.role === 'owner') return '1 = 1';
  // The id comes from our own session lookup, so it's a plain integer.
  if (user?.role === 'author') return `((${VISIBLE_POST}) OR (p.author_id = ${Number(user.id)} AND p.deleted_at IS NULL))`;
  return VISIBLE_POST;
}

export function postSelect(extraColumns = '') {
  return `
    SELECT p.id, p.slug, p.title, p.excerpt, ${TEXT_START}, p.banner_url, p.banner_credit, p.banner_credit_url, p.status, p.published_at, p.updated_at, p.deleted_at,
           p.reading_minutes, p.comments_enabled, p.view_count,
           p.book_id, p.chapter_no, bk.title AS book_title, bk.slug AS book_slug,
           c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
           c.icon AS category_icon, p.featured_at, u.id AS author_id, u.name AS author_name, u.username AS author_username,
           COALESCE(u.avatar_url, u.picture) AS author_picture,
           (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id AND l.removed_at IS NULL) AS like_count,
           (SELECT COUNT(*) FROM comments m WHERE m.post_id = p.id AND m.deleted_at IS NULL) AS comment_count
           ${extraColumns}
      FROM posts p
      JOIN users u ON u.id = p.author_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN books bk ON bk.id = p.book_id`;
}

export type PostStatus = 'draft' | 'scheduled' | 'published';

export function toPostSummary(row: RowDataPacket) {
  const publishedAt: Date | null = row.published_at;
  const status: PostStatus =
    row.status === 'draft' ? 'draft' : publishedAt && publishedAt > new Date() ? 'scheduled' : 'published';
  const commentsEnabled = Boolean(row.comments_enabled);
  return {
    id: row.id as number,
    slug: row.slug as string,
    /** Where it's read (a chapter: under its book). */
    path: postPath(row.slug as string, row.book_id ? (row.book_slug as string) : null),
    title: row.title as string,
    /** What the author wrote, or else the start of the text (summaryOf). */
    excerpt: summaryOf(row),
    bannerUrl: row.banner_url as string | null,
    /** Who made the banner and its licence, when it came from an image library (shown under it). */
    bannerCredit: row.banner_credit ? { text: row.banner_credit as string, url: (row.banner_credit_url as string | null) ?? null } : null,
    status,
    publishedAt,
    updatedAt: row.updated_at as Date,
    /** Only owners ever get deleted posts. */
    deleted: row.deleted_at !== null,
    /** Picked by an administrator for the top of the home page. */
    featured: row.featured_at != null,
    readingMinutes: row.reading_minutes as number,
    likeCount: Number(row.like_count),
    /** Visitors a day each (lib/analytics.ts). */
    viewCount: Number(row.view_count),
    commentsEnabled,
    // Comments are hidden while they're turned off.
    commentCount: commentsEnabled ? Number(row.comment_count) : 0,
    /** The image link previews show (the banner with the title over it), for sharing from a list too. */
    shareImage: shareImagePath(row),
    /** A chapter: its book, and which chapter it is (a post has none). */
    book: row.book_id
      ? { id: row.book_id as number, title: row.book_title as string, slug: row.book_slug as string, chapter: (row.chapter_no as number | null) ?? 0 }
      : null,
    category: row.category_id
      ? { id: row.category_id as number, name: row.category_name as string, slug: row.category_slug as string, icon: row.category_icon as string | null }
      : null,
    author: {
      id: row.author_id as number,
      name: row.author_name as string,
      username: row.author_username as string,
      picture: row.author_picture as string | null,
    },
  };
}

const PAGE_COLUMNS =
  ', p.content_html, p.content_text, p.seo_title, p.seo_description, p.social_image_url, u.occupation AS author_occupation, u.quote AS author_quote, (SELECT COUNT(*) FROM author_follows f WHERE f.author_id = u.id) AS author_followers';

/**
 * A post (/posts/{slug}), or a chapter of a book (/carti/{book}/{slug}: `book` is its slug), as its page shows it,
 * if this viewer may open it. Also returns the plain text, for search engine data.
 */
export async function loadPostPage(db: Pool, slug: string, user: SessionUser | null, book: string | null = null) {
  const [rows] = await db.query<RowDataPacket[]>(
    `${postSelect(PAGE_COLUMNS)}
      WHERE p.slug = ? AND ${book === null ? IS_POST : 'bk.slug = ?'} AND ${visibleTo(user)}`,
    book === null ? [slug] : [slug, book],
  );
  const row = rows[0];
  if (!row) return null;
  return postPageFrom(db, row, user);
}

/** A post by its secret preview link (/previzualizare/{token}): whatever its state, unless deleted. */
export async function loadPreviewPage(db: Pool, token: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    `${postSelect(PAGE_COLUMNS)}
      WHERE p.preview_token = ? AND p.deleted_at IS NULL`,
    [token],
  );
  return rows[0] ? postPageFrom(db, rows[0], null) : null;
}

async function postPageFrom(db: Pool, row: RowDataPacket, user: SessionUser | null) {
  const summary = toPostSummary(row);
  return {
    post: {
      ...summary,
      /** A chapter: its book, with the chapters this viewer can see (the contents, previous / next). */
      book: summary.book && (await bookOfChapter(db, summary.book.id, user)),
      contentHtml: row.content_html as string,
      author: {
        ...summary.author,
        occupation: row.author_occupation as string | null,
        quote: row.author_quote as string | null,
        followers: Number(row.author_followers ?? 0),
      },
      tags: (await tagsOf(db, [summary.id])).get(summary.id) ?? [],
    },
    text: row.content_text as string,
    /** For search engines and link previews (seo/page.ts), when the author wrote them. */
    seo: {
      title: (row.seo_title as string | null) ?? null,
      description: (row.seo_description as string | null) ?? null,
      image: (row.social_image_url as string | null) ?? null,
    },
  };
}

/** Escapes % and _ so user input is matched literally inside LIKE '%...%'. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/** `LIKE` patterns for each word of a search (at most 6 words): the admin panel's lists. */
export const searchWords = (q: string | undefined) =>
  (q ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((word) => `%${escapeLike(word)}%`);
