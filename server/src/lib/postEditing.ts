import type { Pool, RowDataPacket } from 'mysql2/promise';
import { canEditPost } from '@/lib/guards';
import { postSelect, toPostSummary } from '@/lib/posts';
import type { SessionUser } from '@/lib/session';
import { htmlToText, readingMinutes, sanitizePostHtml } from '@/lib/sanitize';
import { uniqueSlug } from '@/lib/slug';

// Writing posts (the editor's saves, routes/people.ts): what a save may contain, checked and turned into columns.

export interface PostBody {
  title: string;
  slug?: string;
  excerpt?: string;
  contentHtml: string;
  bannerUrl?: string | null;
  categoryId?: number | null;
  status: 'draft' | 'published';
  publishedAt?: string | null;
  commentsEnabled?: boolean;
  seriesId?: number | null;
  /** Its part in the series; left out, it comes after the others. */
  seriesPart?: number | null;
  /** Administrators: the author the post is (re)assigned to. */
  authorId?: number;
}

export const postBodySchema = {
  type: 'object',
  required: ['title', 'contentHtml', 'status'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 200 },
    slug: { type: 'string', maxLength: 100 },
    excerpt: { type: 'string', maxLength: 500 },
    contentHtml: { type: 'string', maxLength: 2_000_000 },
    bannerUrl: { type: ['string', 'null'], maxLength: 500 },
    categoryId: { type: ['integer', 'null'], minimum: 1 },
    status: { type: 'string', enum: ['draft', 'published'] },
    publishedAt: { type: ['string', 'null'], format: 'date-time' },
    commentsEnabled: { type: 'boolean' },
    seriesId: { type: ['integer', 'null'], minimum: 1 },
    seriesPart: { type: ['integer', 'null'], minimum: 1, maximum: 999 },
    authorId: { type: 'integer', minimum: 1 },
  },
} as const;

/** Validates and normalizes an editor submission into column values. */
export async function preparePost(db: Pool, body: PostBody, postId?: number) {
  const title = body.title.trim();
  if (!title) return { error: 'title_required' } as const;

  const bannerUrl = body.bannerUrl?.trim() || null;
  if (bannerUrl && !/^(\/uploads\/[\w.-]+|https:\/\/\S+)$/.test(bannerUrl)) return { error: 'banner_invalid' } as const;

  const categoryId = body.categoryId ?? null;
  if (categoryId) {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT id FROM categories WHERE id = ?', [categoryId]);
    if (!rows[0]) return { error: 'category_invalid' } as const;
  }

  const seriesId = body.seriesId ?? null;
  let seriesPart = seriesId ? (body.seriesPart ?? null) : null;
  if (seriesId) {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT id FROM series WHERE id = ?', [seriesId]);
    if (!rows[0]) return { error: 'series_invalid' } as const;
    if (!seriesPart) {
      const [[last]] = await db.execute<RowDataPacket[]>(
        'SELECT COALESCE(MAX(series_part), 0) AS part FROM posts WHERE series_id = ? AND id <> ? AND deleted_at IS NULL',
        [seriesId, postId ?? 0],
      );
      seriesPart = Number(last!.part) + 1;
    }
  }

  const contentHtml = sanitizePostHtml(body.contentHtml);
  const contentText = htmlToText(contentHtml);
  let publishedAt = body.publishedAt ? new Date(body.publishedAt) : null;
  if (body.status === 'published' && !publishedAt) publishedAt = new Date();
  // DATETIME rounds fractional seconds, which could push "now" a second into the future (= scheduled).
  publishedAt?.setMilliseconds(0);

  return {
    values: [
      categoryId,
      title,
      await uniqueSlug(db, 'posts', body.slug?.trim() || title, postId),
      body.excerpt?.trim() ?? '', // empty: the start of the text stands in for it, whatever the text becomes
      contentHtml,
      contentText,
      readingMinutes(contentText),
      bannerUrl,
      body.status,
      publishedAt,
      body.commentsEnabled === false ? 0 : 1,
      seriesId,
      seriesPart,
    ],
  };
}

export const POST_COLUMNS =
  'category_id, title, slug, excerpt, content_html, content_text, reading_minutes, banner_url, status, published_at, comments_enabled, series_id, series_part';

/** The post (not deleted) if this user may edit it. */
export async function findEditable(db: Pool, user: SessionUser | null, id: number | null) {
  if (!id) return null;
  const [rows] = await db.query<RowDataPacket[]>(`${postSelect(', p.content_html')} WHERE p.id = ? AND p.deleted_at IS NULL`, [id]);
  const row = rows[0];
  return row && canEditPost(user, row.author_id as number) ? row : null;
}

/** A post as the editor opens it. */
export function editablePost(row: RowDataPacket) {
  return {
    ...toPostSummary(row),
    // What the author wrote, empty if nothing (the lists show the start of the text instead).
    excerpt: String(row.excerpt ?? ''),
    contentHtml: row.content_html as string,
    // Counted even while comments are off, for the editor's "they'll be hidden" warning.
    existingComments: Number(row.comment_count),
  };
}
