import type { Pool, RowDataPacket } from 'mysql2/promise';
import { makeExcerpt } from '@/lib/sanitize';
import type { SessionUser } from '@/lib/session';
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

/** SQL condition (on alias `p`) for posts the public can see: published, not scheduled for later, not deleted. */
export const VISIBLE_POST = `p.deleted_at IS NULL AND p.status = 'published' AND p.published_at <= UTC_TIMESTAMP()`;

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
    SELECT p.id, p.slug, p.title, p.excerpt, ${TEXT_START}, p.banner_url, p.status, p.published_at, p.updated_at, p.deleted_at,
           p.reading_minutes, p.comments_enabled, p.view_count, p.series_id, p.series_part, s.title AS series_title, s.slug AS series_slug,
           c.id AS category_id, c.name AS category_name, c.slug AS category_slug,
           c.icon AS category_icon, u.id AS author_id, u.name AS author_name, u.username AS author_username,
           COALESCE(u.avatar_url, u.picture) AS author_picture,
           (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id AND l.removed_at IS NULL) AS like_count,
           (SELECT COUNT(*) FROM comments m WHERE m.post_id = p.id AND m.deleted_at IS NULL) AS comment_count
           ${extraColumns}
      FROM posts p
      JOIN users u ON u.id = p.author_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN series s ON s.id = p.series_id`;
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
    title: row.title as string,
    /** What the author wrote, or else the start of the text (summaryOf). */
    excerpt: summaryOf(row),
    bannerUrl: row.banner_url as string | null,
    status,
    publishedAt,
    updatedAt: row.updated_at as Date,
    /** Only owners ever get deleted posts. */
    deleted: row.deleted_at !== null,
    readingMinutes: row.reading_minutes as number,
    likeCount: Number(row.like_count),
    /** Visitors a day each (lib/analytics.ts). */
    viewCount: Number(row.view_count),
    commentsEnabled,
    // Comments are hidden while they're turned off.
    commentCount: commentsEnabled ? Number(row.comment_count) : 0,
    /** The image link previews show (the banner with the title over it), for sharing from a list too. */
    shareImage: shareImagePath(row),
    /** The series it's part of, and which part. */
    series: row.series_id
      ? { id: row.series_id as number, title: row.series_title as string, slug: row.series_slug as string, part: row.series_part as number }
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

/**
 * A post as its page shows it, if this viewer may open it (null for public visitors means: the public version).
 * Also returns the plain text, for search engine data.
 */
export async function loadPostPage(db: Pool, slug: string, user: SessionUser | null) {
  const [rows] = await db.query<RowDataPacket[]>(
    `${postSelect(', p.content_html, p.content_text, u.occupation AS author_occupation, u.quote AS author_quote')}
      WHERE p.slug = ? AND ${visibleTo(user)}`,
    [slug],
  );
  const row = rows[0];
  if (!row) return null;
  const summary = toPostSummary(row);
  // The series' parts this viewer can see, in order, for the "Part 2 of 4" box and "next".
  const [parts] = summary.series
    ? await db.query<RowDataPacket[]>(
        `SELECT p.id, p.title, p.slug, p.series_part FROM posts p WHERE p.series_id = ? AND ${visibleTo(user)} ORDER BY p.series_part, p.published_at, p.id`,
        [summary.series.id],
      )
    : [[] as RowDataPacket[]];
  return {
    post: {
      ...summary,
      series: summary.series && {
        ...summary.series,
        parts: parts.map((part) => ({ id: part.id as number, title: part.title as string, slug: part.slug as string, part: part.series_part as number })),
      },
      contentHtml: row.content_html as string,
      author: { ...summary.author, occupation: row.author_occupation as string | null, quote: row.author_quote as string | null },
    },
    text: row.content_text as string,
  };
}

/** Escapes % and _ so user input is matched literally inside LIKE '%...%'. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');
