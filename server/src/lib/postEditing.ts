import type { Pool, RowDataPacket } from 'mysql2/promise';
import { canEditPost } from '@/lib/guards';
import { kindCondition, postSelect, toPostSummary } from '@/lib/posts';
import type { Kind } from '@/lib/posts';
import type { SessionUser } from '@/lib/session';
import { htmlToText, readingMinutes, sanitizePostHtml } from '@/lib/sanitize';
import { uniqueSlug } from '@/lib/slug';

// Writing posts and chapters (the editor's saves: routes/people.ts, routes/books.ts): what a save may contain,
// checked and turned into columns. The same editor writes both; a post may have a category and never a book, a
// chapter always has a book (and its number there) and never a category (its book has one).

export interface PostBody {
  title: string;
  slug?: string;
  excerpt?: string;
  contentHtml: string;
  bannerUrl?: string | null;
  /** The banner's credit (an image from a library): who made it and its licence, and the page it comes from. */
  bannerCredit?: string | null;
  bannerCreditUrl?: string | null;
  /** A post's category (a chapter has none). */
  categoryId?: number | null;
  status: 'draft' | 'published';
  publishedAt?: string | null;
  commentsEnabled?: boolean;
  /** A chapter: another of the author's books to move it to (else it stays in its own, or the address's), and its
   *  number there; left out, after the others. */
  bookId?: number | null;
  chapterNo?: number | null;
  /** Administrators: the author the post is (re)assigned to. */
  authorId?: number;
  /** For search engines and link previews, instead of the title and the summary (empty: those). */
  seoTitle?: string;
  seoDescription?: string;
  /** The image link previews show, instead of the one made from the banner. */
  socialImageUrl?: string | null;
  /** Free words besides the category (lib/tags.ts). */
  tags?: string[];
  /** An earlier version was brought back (the editor's history): the text it replaces is kept as a version too. */
  restoredVersion?: boolean;
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
    bannerCredit: { type: ['string', 'null'], maxLength: 300 },
    bannerCreditUrl: { type: ['string', 'null'], maxLength: 500 },
    categoryId: { type: ['integer', 'null'], minimum: 1 },
    status: { type: 'string', enum: ['draft', 'published'] },
    publishedAt: { type: ['string', 'null'], format: 'date-time' },
    commentsEnabled: { type: 'boolean' },
    bookId: { type: ['integer', 'null'], minimum: 1 },
    chapterNo: { type: ['integer', 'null'], minimum: 1, maximum: 999 },
    authorId: { type: 'integer', minimum: 1 },
    seoTitle: { type: 'string', maxLength: 200 },
    seoDescription: { type: 'string', maxLength: 300 },
    socialImageUrl: { type: ['string', 'null'], maxLength: 500 },
    tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 80 } },
    restoredVersion: { type: 'boolean' },
  },
} as const;

/** What an untitled draft's address is until it has a title. */
const UNTITLED_SLUG = 'ciorna';

/** A post's title for the administrators' log (an untitled draft has none yet). */
export const postLabel = (title: string) => title || 'Ciornă fără titlu';

/**
 * Validates and normalizes an editor submission into column values. `authorId`: whose post it is, or will be;
 * `bookId`, for a chapter: its book (the one it's in, or the address's for a new one), unless the body moves it.
 */
export async function preparePost(db: Pool, body: PostBody, authorId: number, postId?: number, bookId: number | null = null) {
  const title = body.title.trim();
  // A draft may have no title yet (it saves itself while it's being written); a post going public needs one.
  if (!title && body.status !== 'draft') return { error: 'title_required' } as const;

  const imageUrl = /^(\/uploads\/[\w.-]+|https:\/\/\S+)$/;
  const bannerUrl = body.bannerUrl?.trim() || null;
  if (bannerUrl && !imageUrl.test(bannerUrl)) return { error: 'banner_invalid' } as const;
  // A credit goes with a banner; its link only to a web page.
  const bannerCredit = (bannerUrl && body.bannerCredit?.trim()) || null;
  const bannerCreditUrl = (bannerCredit && body.bannerCreditUrl?.trim()) || null;
  if (bannerCreditUrl && !/^https?:\/\/\S+$/.test(bannerCreditUrl)) return { error: 'banner_invalid' } as const;
  const socialImageUrl = body.socialImageUrl?.trim() || null;
  if (socialImageUrl && !imageUrl.test(socialImageUrl)) return { error: 'banner_invalid' } as const;

  // A chapter has no category of its own (its book has one).
  const categoryId = bookId ? null : (body.categoryId ?? null);
  if (categoryId) {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT id FROM categories WHERE id = ?', [categoryId]);
    if (!rows[0]) return { error: 'category_invalid' } as const;
  }

  // A chapter: of one of the author's books (not deleted), numbered after the others unless the editor says where.
  if (bookId && body.bookId) bookId = body.bookId;
  let chapterNo = bookId ? (body.chapterNo ?? null) : null;
  if (bookId) {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT author_id FROM books WHERE id = ? AND deleted_at IS NULL', [bookId]);
    if (!rows[0] || rows[0].author_id !== authorId) return { error: 'book_invalid' } as const;
    if (!chapterNo) {
      const [[last]] = await db.execute<RowDataPacket[]>(
        'SELECT book_id, chapter_no FROM posts WHERE id = ?',
        [postId ?? 0],
      );
      if (last && last.book_id === bookId && last.chapter_no) chapterNo = last.chapter_no as number;
      else {
        const [[max]] = await db.execute<RowDataPacket[]>(
          'SELECT COALESCE(MAX(chapter_no), 0) AS n FROM posts WHERE book_id = ? AND id <> ? AND deleted_at IS NULL',
          [bookId, postId ?? 0],
        );
        chapterNo = Number(max!.n) + 1;
      }
    }
  }

  // The address: the one given, else from the title. An untitled draft gets a stand-in, which follows the title once
  // there is one (unless another address was chosen meanwhile).
  const [[stored]] = postId ? await db.execute<RowDataPacket[]>('SELECT title, slug FROM posts WHERE id = ?', [postId]) : [[]];
  const given = body.slug?.trim() ?? '';
  const standIn = stored !== undefined && !stored.title && given === stored.slug;
  const slugFrom = (!standIn && given) || title || UNTITLED_SLUG;

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
      await uniqueSlug(db, 'posts', slugFrom, postId),
      body.excerpt?.trim() ?? '', // empty: the start of the text stands in for it, whatever the text becomes
      contentHtml,
      contentText,
      readingMinutes(contentText),
      bannerUrl,
      bannerCredit,
      bannerCreditUrl,
      body.status,
      publishedAt,
      body.commentsEnabled === false ? 0 : 1,
      bookId,
      chapterNo,
      body.seoTitle?.trim() || null,
      body.seoDescription?.trim() || null,
      socialImageUrl,
    ],
    /** For the version kept before the save (lib/revisions.ts). */
    revision: { title, excerpt: body.excerpt?.trim() ?? '', contentHtml, bannerUrl },
  };
}

export const POST_COLUMNS =
  'category_id, title, slug, excerpt, content_html, content_text, reading_minutes, banner_url, banner_credit, banner_credit_url, status, published_at, comments_enabled, book_id, chapter_no, ' +
  'seo_title, seo_description, social_image_url';

/** The post, or the chapter (`kind`), not deleted, if this user may edit it. */
export async function findEditable(db: Pool, user: SessionUser | null, id: number | null, kind: Kind = 'post') {
  if (!id) return null;
  const [rows] = await db.query<RowDataPacket[]>(
    `${postSelect(', p.content_html, p.seo_title, p.seo_description, p.social_image_url, p.preview_token')} WHERE p.id = ? AND p.deleted_at IS NULL AND ${kindCondition(kind)}`,
    [id],
  );
  const row = rows[0];
  return row && canEditPost(user, row.author_id as number) ? row : null;
}

/** A post as the editor opens it (with its tags, from tagsOf). */
export function editablePost(row: RowDataPacket, tags: { name: string; slug: string }[] = []) {
  return {
    ...toPostSummary(row),
    seoTitle: (row.seo_title as string | null) ?? '',
    seoDescription: (row.seo_description as string | null) ?? '',
    socialImageUrl: (row.social_image_url as string | null) ?? null,
    tags: tags.map((tag) => tag.name),
    /** The secret preview link's token, if one was made (/previzualizare/{token}). */
    previewToken: (row.preview_token as string | null) ?? null,
    // What the author wrote, empty if nothing (the lists show the start of the text instead).
    excerpt: String(row.excerpt ?? ''),
    contentHtml: row.content_html as string,
    // Counted even while comments are off, for the editor's "they'll be hidden" warning.
    existingComments: Number(row.comment_count),
  };
}
