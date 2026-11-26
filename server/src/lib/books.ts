import type { Pool, RowDataPacket } from 'mysql2/promise';
import { canEditPost } from '@/lib/guards';
import { PUBLISHED_POST, summaryOf, TEXT_START, VISIBLE_POST, visibleTo } from '@/lib/posts';
import type { SessionUser } from '@/lib/session';
import { ORNAMENT_IDS } from '../../../ornaments';
import { PALETTE_IDS } from '../../../palettes';
import type { PaletteId } from '../../../palettes';
import type { OrnamentId } from '../../../ornaments';

// Books: read chapter by chapter. Each chapter is a post with the book and its number (posts.book_id, chapter_no),
// so it has everything a post has. A book is on the site once one of its chapters is; until then only its author
// and administrators see it. Its cover isn't an image: a design (layout, ornament, colours) the client draws
// (client/src/lib/covers.ts), with the book's title and subject on it.

/** What a cover may be made of; the client has the drawings (client/src/lib/covers.ts). */
export const COVER_LAYOUTS = ['clasic', 'centrat', 'banda', 'arc', 'rasarit', 'eticheta', 'tipografic', 'medalion'] as const;
/** The ornaments: the library the client draws them from (ornaments.ts, at the project's root). */
export const COVER_ORNAMENTS = ORNAMENT_IDS;
/** The palettes: the client's (palettes.ts, at the project's root). */
export const COVER_PALETTES = PALETTE_IDS;

export interface CoverDesign {
  /** The template it started from (a built-in one's id, or "sablon-{id}" for a saved one), to show it chosen. */
  template?: string;
  layout: (typeof COVER_LAYOUTS)[number];
  ornament: OrnamentId;
  palette: PaletteId;
  /** The writer's own colours instead of the palette's: the top, the bottom, the writing. */
  colors?: { c1: string; c2: string; ink: string };
}

export const DEFAULT_COVER: CoverDesign = { template: 'lotus', layout: 'clasic', ornament: 'lotus', palette: 'pergament' };

const HEX = /^#[0-9a-f]{6}$/i;

/** A cover design as sent by the editor, checked; null if it isn't one. */
export function cleanCover(input: unknown): CoverDesign | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const layout = COVER_LAYOUTS.find((id) => id === value.layout);
  const ornament = COVER_ORNAMENTS.find((id) => id === value.ornament);
  const palette = COVER_PALETTES.find((id) => id === value.palette);
  if (!layout || !ornament || !palette) return null;
  const design: CoverDesign = { layout, ornament, palette };
  if (typeof value.template === 'string' && /^[a-z0-9-]{1,40}$/.test(value.template)) design.template = value.template;
  const colors = value.colors as Record<string, unknown> | null | undefined;
  if (colors && typeof colors === 'object') {
    const { c1, c2, ink } = colors;
    if (typeof c1 !== 'string' || typeof c2 !== 'string' || typeof ink !== 'string' || ![c1, c2, ink].every((c) => HEX.test(c))) return null;
    design.colors = { c1: c1.toLowerCase(), c2: c2.toLowerCase(), ink: ink.toLowerCase() };
  }
  return design;
}

/** The cover column as stored (JSON), whatever the driver gives back. */
function coverOf(value: unknown): CoverDesign {
  const parsed = typeof value === 'string' ? safeJson(value) : value;
  return cleanCover(parsed) ?? DEFAULT_COVER;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** SQL (on alias `bk`) for a book with its subject, author and chapter numbers: what the lists show. */
export function bookSelect(extraColumns = '') {
  return `
    SELECT bk.id, bk.slug, bk.title, bk.description, bk.cover, bk.planned_chapters, bk.completed_at, bk.published_at, bk.created_at, bk.updated_at,
           c.id AS category_id, c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon,
           u.id AS author_id, u.name AS author_name, u.username AS author_username, COALESCE(u.avatar_url, u.picture) AS author_picture,
           (SELECT COUNT(*) FROM posts p WHERE p.book_id = bk.id AND ${PUBLISHED_POST}) AS chapters,
           (SELECT COUNT(*) FROM posts p WHERE p.book_id = bk.id AND p.deleted_at IS NULL) AS all_chapters,
           (SELECT COALESCE(SUM(p.reading_minutes), 0) FROM posts p WHERE p.book_id = bk.id AND ${PUBLISHED_POST}) AS minutes,
           (SELECT MAX(p.published_at) FROM posts p WHERE p.book_id = bk.id AND ${PUBLISHED_POST}) AS last_chapter_at,
           (SELECT MIN(p.published_at) FROM posts p WHERE p.book_id = bk.id AND p.deleted_at IS NULL AND p.status = 'published'
               AND p.published_at > UTC_TIMESTAMP()) AS next_chapter_at,
           (SELECT p.slug FROM posts p WHERE p.book_id = bk.id AND ${PUBLISHED_POST} ORDER BY p.chapter_no, p.published_at, p.id LIMIT 1) AS first_slug
           ${extraColumns}
      FROM books bk
      JOIN users u ON u.id = bk.author_id
      LEFT JOIN categories c ON c.id = bk.category_id`;
}

export function toBook(row: RowDataPacket) {
  const chapters = Number(row.chapters);
  const planned = (row.planned_chapters as number | null) ?? null;
  return {
    id: row.id as number,
    slug: row.slug as string,
    title: row.title as string,
    description: row.description as string,
    cover: coverOf(row.cover),
    /** How many chapters the author plans (null: not said). */
    planned,
    /** The author said it's finished (else it's still being written). */
    complete: row.completed_at !== null,
    /** On the site (its author published it); unpublished, only its author and administrators see it. */
    published: row.published_at !== null,
    /** Chapters on the site; all of them (drafts and scheduled ones too) for whoever may edit it. */
    chapters,
    allChapters: Number(row.all_chapters),
    /** Reading time of the chapters on the site. */
    minutes: Number(row.minutes),
    lastChapterAt: (row.last_chapter_at as Date | null) ?? null,
    /** The next scheduled chapter's date. */
    nextChapterAt: (row.next_chapter_at as Date | null) ?? null,
    /** Where reading starts. */
    firstChapter: (row.first_slug as string | null) ?? null,
    updatedAt: row.updated_at as Date,
    subject: row.category_id
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

export type Book = ReturnType<typeof toBook>;

/** SQL condition (on alias `bk`): on the site (published, not deleted, at least one chapter out). A function: posts.ts
 *  and this module import each other, so nothing of the other may be used while they load. */
export const publicBook = () => `bk.deleted_at IS NULL AND bk.published_at IS NOT NULL AND EXISTS (SELECT 1 FROM posts p WHERE p.book_id = bk.id AND ${PUBLISHED_POST})`;

/** Whether this viewer may edit the book (its author, or an administrator). */
export const canEditBook = (user: SessionUser | null, book: { author: { id: number } }) => canEditPost(user, book.author.id);

export type ChapterState = 'published' | 'scheduled' | 'draft';

export interface Chapter {
  id: number;
  /** Null for a chapter this viewer can't open yet (scheduled: only its title and date are shown). */
  slug: string | null;
  no: number;
  title: string;
  excerpt: string;
  minutes: number;
  publishedAt: Date | null;
  state: ChapterState;
}

/**
 * The book's chapters, in order: those this viewer can open, and the scheduled ones (their titles and dates: what's
 * coming next). Drafts only for whoever may edit them.
 */
export async function chaptersOf(db: Pool, bookIds: number[], user: SessionUser | null): Promise<Map<number, Chapter[]>> {
  const result = new Map<number, Chapter[]>(bookIds.map((id) => [id, []]));
  if (bookIds.length === 0) return result;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.id, p.book_id, p.slug, p.chapter_no, p.title, p.excerpt, ${TEXT_START}, p.reading_minutes, p.status, p.published_at,
            (${visibleTo(user)}) AS can_open
       FROM posts p
      WHERE p.book_id IN (?) AND p.deleted_at IS NULL
        AND ((${visibleTo(user)}) OR (p.status = 'published' AND p.published_at > UTC_TIMESTAMP()))
      ORDER BY p.book_id, p.chapter_no, p.published_at, p.id`,
    [bookIds],
  );
  for (const row of rows) {
    const publishedAt = (row.published_at as Date | null) ?? null;
    const state: ChapterState = row.status === 'draft' ? 'draft' : publishedAt && publishedAt > new Date() ? 'scheduled' : 'published';
    result.get(row.book_id as number)!.push({
      id: row.id as number,
      slug: Number(row.can_open) ? (row.slug as string) : null,
      no: (row.chapter_no as number | null) ?? 0,
      title: row.title as string,
      excerpt: summaryOf(row),
      minutes: row.reading_minutes as number,
      publishedAt,
      state,
    });
  }
  return result;
}

/** A chapter's book, as its page shows it: the book and its contents (for previous / next). */
export async function bookOfChapter(db: Pool, bookId: number, user: SessionUser | null) {
  const [rows] = await db.query<RowDataPacket[]>(`${bookSelect()} WHERE bk.id = ? AND bk.deleted_at IS NULL`, [bookId]);
  if (!rows[0]) return null;
  const book = toBook(rows[0]);
  return { ...book, contents: (await chaptersOf(db, [bookId], user)).get(bookId) ?? [] };
}

// ---------- Reading: where each reader is, for "continue reading", their journeys and the streak ----------

export interface ProgressEntry {
  postId: number;
  /** 0-100: how far down the text they got. */
  progress: number;
  updatedAt: Date;
  finished: boolean;
}

/** Read past this (percent), a chapter counts as read. */
export const FINISHED_AT = 92;

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** The days in a row they read, ending today (or yesterday, if they haven't read yet today), and this week's days. */
export function streakOf(days: Set<string>, today: string) {
  const base = new Date(`${today}T00:00:00Z`);
  const shift = (date: Date, by: number) => new Date(date.getTime() + by * 86_400_000);
  let cursor = days.has(today) ? base : shift(base, -1);
  let count = 0;
  while (days.has(isoDay(cursor)) && count < 3650) {
    count++;
    cursor = shift(cursor, -1);
  }
  // Monday to Sunday of this week.
  const monday = shift(base, -((base.getUTCDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = isoDay(shift(monday, index));
    return { day, read: days.has(day), today: day === today, future: day > today };
  });
  return { days: count, readToday: days.has(today), week };
}

/**
 * Where a reader is in each book they started (from their progress in posts, newest first): the chapters with the
 * ones read, the one to read now (the latest one started, or the one after it once it's read) and how far into it.
 */
export async function journeysOf(db: Pool, entries: ProgressEntry[], user: SessionUser | null) {
  if (entries.length === 0) return [];
  const byPost = new Map(entries.map((entry) => [entry.postId, entry]));
  const [posts] = await db.query<RowDataPacket[]>(
    `SELECT p.id, p.book_id FROM posts p WHERE p.id IN (?) AND p.book_id IS NOT NULL AND ${visibleTo(user)}`,
    [[...byPost.keys()]],
  );
  // Books in the order they were last read.
  const lastRead = new Map<number, number>();
  for (const post of posts) {
    const at = byPost.get(post.id as number)!.updatedAt.getTime();
    lastRead.set(post.book_id as number, Math.max(lastRead.get(post.book_id as number) ?? 0, at));
  }
  const bookIds = [...lastRead.keys()].sort((a, b) => lastRead.get(b)! - lastRead.get(a)!).slice(0, 12);
  if (bookIds.length === 0) return [];
  const [bookRows] = await db.query<RowDataPacket[]>(`${bookSelect()} WHERE bk.id IN (?) AND bk.deleted_at IS NULL`, [bookIds]);
  const books = new Map(bookRows.map((row) => [row.id as number, toBook(row)]));
  const contents = await chaptersOf(db, bookIds, user);

  return bookIds.flatMap((bookId) => {
    const book = books.get(bookId);
    if (!book) return [];
    const chapters = contents.get(bookId) ?? [];
    const readable = chapters.filter((chapter) => chapter.slug);
    const done = (chapter: Chapter) => {
      const entry = byPost.get(chapter.id);
      return Boolean(entry && (entry.finished || entry.progress >= FINISHED_AT));
    };
    // The latest one they opened; once read, the next one they haven't.
    const latest = readable
      .filter((chapter) => byPost.has(chapter.id))
      .sort((a, b) => byPost.get(b.id)!.updatedAt.getTime() - byPost.get(a.id)!.updatedAt.getTime())[0];
    let current: Chapter | undefined = latest && !done(latest) ? latest : undefined;
    if (!current && latest) current = readable.slice(readable.indexOf(latest) + 1).find((chapter) => !done(chapter));
    if (!current) current = readable.find((chapter) => !done(chapter));
    const progress = current ? Math.min(100, byPost.get(current.id)?.progress ?? 0) : 100;
    return [
      {
        book,
        chapters: chapters.map((chapter) => ({ ...chapter, done: done(chapter), current: chapter.id === current?.id })),
        current: current ? { ...current, progress, minutesLeft: Math.max(1, Math.ceil(current.minutes * (1 - progress / 100))) } : null,
        read: readable.filter(done).length,
        lastReadAt: new Date(lastRead.get(bookId)!),
      },
    ];
  });
}

export type Journey = Awaited<ReturnType<typeof journeysOf>>[number];

/**
 * The newest books on the site (by their latest chapter) as journeys not started yet: at their first chapter, nothing
 * read. The home page fills its three journeys with them after the reader's own.
 */
export async function startJourneys(db: Pool, user: SessionUser | null, limit = 3) {
  const [rows] = await db.query<RowDataPacket[]>(`${bookSelect()} WHERE ${publicBook()} ORDER BY last_chapter_at DESC, bk.id DESC LIMIT ${Number(limit)}`);
  const books = rows.map(toBook);
  const contents = await chaptersOf(db, books.map((book) => book.id), user);
  return books.map((book) => {
    const chapters = contents.get(book.id) ?? [];
    const first = chapters.find((chapter) => chapter.slug);
    return {
      book,
      chapters: chapters.map((chapter) => ({ ...chapter, done: false, current: chapter.id === first?.id })),
      current: first ? { ...first, progress: 0, minutesLeft: Math.max(1, first.minutes) } : null,
      read: 0,
      lastReadAt: null,
    };
  });
}

/** The reader's whole picture: what to read now, their journeys and their streak. */
export async function readingSummary(db: Pool, entries: ProgressEntry[], days: Set<string>, today: string, user: SessionUser | null) {
  const journeys = await journeysOf(db, entries, user);
  const active = journeys.find((journey) => journey.current);
  return {
    current: active ? { book: active.book, chapter: active.current!, read: active.read } : null,
    journeys,
    streak: streakOf(days, today),
  };
}

/** A signed-in reader's progress and reading days, from the database. */
export async function storedReading(db: Pool, userId: number) {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT post_id, progress, updated_at, finished_at FROM reading_progress WHERE user_id = ? ORDER BY updated_at DESC LIMIT 300',
    [userId],
  );
  const [dayRows] = await db.execute<RowDataPacket[]>(
    'SELECT day FROM reading_days WHERE user_id = ? AND day >= UTC_DATE() - INTERVAL 400 DAY',
    [userId],
  );
  return {
    entries: rows.map((row) => ({
      postId: row.post_id as number,
      progress: row.progress as number,
      updatedAt: row.updated_at as Date,
      finished: row.finished_at !== null,
    })),
    // DATE columns come back as dates at UTC midnight.
    days: new Set(dayRows.map((row) => (row.day instanceof Date ? isoDay(row.day) : String(row.day)))),
  };
}

/** A local day the reader's device gives ("2026-11-24"), if it's within a day of now (time zones). */
export function validDay(day: unknown): string | null {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(at) && Math.abs(at - Date.now()) < 2 * 86_400_000 ? day : null;
}

/** Stores progress in a post (the furthest point reached); a day counts as a reading day past a fifth of a text. */
export async function saveProgress(db: Pool, userId: number, postId: number, progress: number, day: string | null, at = new Date()) {
  const value = Math.max(0, Math.min(100, Math.round(progress)));
  const finished = value >= FINISHED_AT ? at : null;
  await db.execute(
    `INSERT INTO reading_progress (user_id, post_id, progress, updated_at, finished_at) VALUES (?, ?, ?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE progress = GREATEST(reading_progress.progress, new.progress), updated_at = GREATEST(reading_progress.updated_at, new.updated_at),
                               finished_at = COALESCE(reading_progress.finished_at, new.finished_at)`,
    [userId, postId, value, at, finished],
  );
  if (day && value >= 20) await db.execute('INSERT IGNORE INTO reading_days (user_id, day) VALUES (?, ?)', [userId, day]);
}

// ---------- The thought of the day: a quote from the books (and articles) ----------

let thoughtCache: { day: string; thought: Thought | null } | null = null;

export interface Thought {
  text: string;
  post: { id: number; slug: string; title: string };
  book: { slug: string; title: string; chapter: number } | null;
}

const decodeEntities = (text: string) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/**
 * A quote the authors put in their texts (a blockquote), a different one each day: from the books' chapters when
 * there are some, else from the articles. Null when there's none.
 */
export async function thoughtOfTheDay(db: Pool, today: string): Promise<Thought | null> {
  if (thoughtCache?.day === today) return thoughtCache.thought;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.id, p.slug, p.title, p.content_html, p.chapter_no, bk.slug AS book_slug, bk.title AS book_title
       FROM posts p LEFT JOIN books bk ON bk.id = p.book_id AND bk.deleted_at IS NULL
      WHERE ${VISIBLE_POST} AND p.content_html LIKE '%<blockquote%'
      ORDER BY p.book_id IS NULL, p.id
      LIMIT 300`,
  );
  const quotes: Thought[] = [];
  for (const row of rows) {
    for (const match of String(row.content_html).matchAll(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/g)) {
      // Without the quotation marks around it: the page draws its own.
      const text = decodeEntities(match[1]!.replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[„“"«]([\s\S]*)[”"»]([.!?…]?)$/, '$1$2')
        .trim();
      if (text.length < 30 || text.length > 260) continue;
      quotes.push({
        text,
        post: { id: row.id as number, slug: row.slug as string, title: row.title as string },
        book: row.book_slug ? { slug: row.book_slug as string, title: row.book_title as string, chapter: (row.chapter_no as number | null) ?? 0 } : null,
      });
    }
  }
  const fromBooks = quotes.filter((quote) => quote.book);
  const pool = fromBooks.length ? fromBooks : quotes;
  const dayNumber = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);
  const thought = pool.length ? pool[dayNumber % pool.length]! : null;
  thoughtCache = { day: today, thought };
  return thought;
}

/** The thought changes when texts do: published, edited or deleted ones may add or remove quotes. */
export const forgetThought = () => {
  thoughtCache = null;
};
