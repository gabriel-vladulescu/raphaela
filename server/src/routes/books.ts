import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logAdmin } from '@/lib/adminLog';
import {
  bookSelect,
  canEditBook,
  chaptersOf,
  cleanCover,
  DEFAULT_COVER,
  publicBook,
  readingSummary,
  forgetThought,
  saveProgress,
  startJourneys,
  storedReading,
  thoughtOfTheDay,
  toBook,
  validDay,
} from '@/lib/books';
import type { ProgressEntry } from '@/lib/books';
import { loadCategoryIndex } from '@/lib/categories';
import { parseId, requireUser, requireWriter } from '@/lib/guards';
import { findPerson, isPublicList } from '@/lib/people';
import { IS_POST, postSelect, toPostSummary, VISIBLE_POST, visibleTo } from '@/lib/posts';
import type { SessionUser } from '@/lib/session';
import { uniqueSlug } from '@/lib/slug';

interface BookBody {
  title: string;
  description?: string;
  categoryId?: number | null;
  cover?: unknown;
  plannedChapters?: number | null;
  complete?: boolean;
  /** On the site, or hidden (a new book starts hidden unless this says otherwise). */
  published?: boolean;
}

const bookBodySchema = {
  type: 'object',
  required: ['title'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', maxLength: 160 },
    description: { type: 'string', maxLength: 1000 },
    categoryId: { type: ['integer', 'null'], minimum: 1 },
    cover: { type: 'object' },
    plannedChapters: { type: ['integer', 'null'], minimum: 1, maximum: 999 },
    complete: { type: 'boolean' },
    published: { type: 'boolean' },
  },
} as const;

const coverDesignSchema = { type: 'object' } as const;

/** Progress as a browser keeps it (guests), sent to see their journeys or to bring them into the account. */
const entriesSchema = {
  type: 'array',
  maxItems: 300,
  items: {
    type: 'object',
    required: ['postId', 'progress', 'at'],
    properties: {
      postId: { type: 'integer', minimum: 1 },
      progress: { type: 'number', minimum: 0, maximum: 100 },
      at: { type: 'string', maxLength: 40 },
      finished: { type: 'boolean' },
    },
  },
} as const;

interface EntryBody {
  postId: number;
  progress: number;
  at: string;
  finished?: boolean;
}

const daysSchema = { type: 'array', maxItems: 400, items: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } as const;

/** Entries from a browser: valid dates only, never in the future. */
function toEntries(list: EntryBody[]): ProgressEntry[] {
  const now = Date.now();
  return list
    .map((entry) => ({ postId: entry.postId, progress: entry.progress, updatedAt: new Date(Math.min(Date.parse(entry.at) || 0, now)), finished: entry.finished === true }))
    .filter((entry) => entry.updatedAt.getTime() > 0)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

const todayOf = (value: unknown) => validDay(value) ?? new Date().toISOString().slice(0, 10);

/**
 * Books (lib/books.ts): the home page's picture (the thought of the day, the books, the subjects, the latest
 * articles), the library, a book with its contents, the subjects; a reader's progress; and, under /u/{username}/carti,
 * the writers' own books (REST style, like their articles in routes/people.ts) and the saved cover designs.
 */
const bookRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  /** The top-level categories (the subjects), with how many books and articles each has (its sub-categories too). */
  async function subjects() {
    const [categories] = await db.query<RowDataPacket[]>(
      'SELECT id, name, slug, icon, description FROM categories WHERE parent_id IS NULL ORDER BY position, name',
    );
    const index = await loadCategoryIndex(db);
    const [bookRows] = await db.query<RowDataPacket[]>(`${bookSelect()} WHERE ${publicBook()} ORDER BY last_chapter_at DESC`);
    const books = bookRows.map(toBook);
    const [postRows] = await db.query<RowDataPacket[]>(
      `SELECT p.category_id, COUNT(*) AS n FROM posts p WHERE ${VISIBLE_POST} AND p.book_id IS NULL AND p.category_id IS NOT NULL GROUP BY p.category_id`,
    );
    const articlesIn = new Map(postRows.map((row) => [row.category_id as number, Number(row.n)]));
    return categories
      .map((category) => {
        const ids = new Set(index.descendants(category.id as number));
        const theirs = books.filter((book) => book.subject && ids.has(book.subject.id));
        return {
          id: category.id as number,
          name: category.name as string,
          slug: category.slug as string,
          icon: (category.icon as string | null) ?? null,
          description: (category.description as string | null) ?? null,
          books: theirs.length,
          articles: [...ids].reduce((sum, id) => sum + (articlesIn.get(id) ?? 0), 0),
          /** A book of theirs, to show its cover. */
          cover: theirs[0] ? { cover: theirs[0].cover, title: theirs[0].title, subject: theirs[0].subject?.name ?? '' } : null,
        };
      })
      .filter((subject) => subject.books + subject.articles > 0);
  }

  async function publicBooks(where = '', params: unknown[] = []) {
    const [rows] = await db.query<RowDataPacket[]>(
      `${bookSelect()} WHERE ${publicBook()} ${where} ORDER BY last_chapter_at DESC, bk.id DESC LIMIT 100`,
      params,
    );
    return rows.map(toBook);
  }

  // The home page: the thought of the day, the books, the subjects, the latest articles and the newest chapter
  // (what to read when there's nothing started).
  app.get<{ Querystring: { today?: string } }>(
    '/home',
    { schema: { querystring: { type: 'object', properties: { today: { type: 'string', maxLength: 10 } } } } },
    async (req) => {
      const today = todayOf(req.query.today);
      // The latest five articles (the journal's; not the books' chapters).
      const [journal] = await db.query<RowDataPacket[]>(`${postSelect()} WHERE ${VISIBLE_POST} AND ${IS_POST} ORDER BY p.published_at DESC, p.id DESC LIMIT 5`);
      const [latest] = await db.query<RowDataPacket[]>(
        `SELECT p.id, p.book_id FROM posts p WHERE ${VISIBLE_POST} AND p.book_id IS NOT NULL ORDER BY p.published_at DESC LIMIT 1`,
      );
      const books = await publicBooks();
      let latestChapter = null;
      if (latest[0]) {
        const book = books.find((b) => b.id === latest[0]!.book_id);
        const chapter = (await chaptersOf(db, [latest[0].book_id as number], req.user)).get(latest[0].book_id as number)?.find((c) => c.id === latest[0]!.id);
        if (book && chapter) latestChapter = { book, chapter };
      }
      return {
        thought: await thoughtOfTheDay(db, today),
        books,
        subjects: await subjects(),
        journal: journal.map(toPostSummary),
        latestChapter,
        /** The newest books, not started (nothing read): the home page's journeys after the reader's own. */
        starts: await startJourneys(db, req.user, 3),
      };
    },
  );

  // The library: every book on the site, or a subject's (its sub-categories too).
  app.get<{ Querystring: { subject?: string } }>(
    '/books',
    { schema: { querystring: { type: 'object', properties: { subject: { type: 'string', maxLength: 100 } } } } },
    async (req, reply) => {
      if (!req.query.subject) return { books: await publicBooks() };
      const [rows] = await db.execute<RowDataPacket[]>('SELECT id FROM categories WHERE slug = ?', [req.query.subject]);
      if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
      return { books: await publicBooks('AND bk.category_id IN (?)', [(await loadCategoryIndex(db)).descendants(rows[0].id as number)]) };
    },
  );

  // A book and its contents; the reader's progress in its chapters when signed in (guests have theirs in the browser).
  app.get<{ Params: { slug: string } }>('/books/:slug', async (req, reply) => {
    const [rows] = await db.query<RowDataPacket[]>(`${bookSelect()} WHERE bk.slug = ? AND bk.deleted_at IS NULL`, [req.params.slug]);
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
    const book = toBook(rows[0]);
    const canEdit = canEditBook(req.user, book);
    // Unpublished, or nothing out yet: only for its author and administrators.
    if ((book.chapters === 0 || !book.published) && !canEdit) return reply.code(404).send({ error: 'not_found' });
    const contents = (await chaptersOf(db, [book.id], req.user)).get(book.id) ?? [];
    const progress: Record<number, number> = {};
    if (req.user && contents.length) {
      const [mine] = await db.query<RowDataPacket[]>(
        'SELECT post_id, progress, finished_at FROM reading_progress WHERE user_id = ? AND post_id IN (?)',
        [req.user.id, contents.map((chapter) => chapter.id)],
      );
      for (const row of mine) progress[row.post_id as number] = row.finished_at ? 100 : (row.progress as number);
    }
    // Other books on the same subject.
    const related = book.subject ? (await publicBooks('AND bk.category_id = ? AND bk.id <> ?', [book.subject.id, book.id])).slice(0, 4) : [];
    return { book, contents, progress, canEdit, related };
  });

  // The subjects, and one of them: its books (its articles come from /posts?category=).
  app.get('/subjects', async () => ({ subjects: await subjects() }));

  app.get<{ Params: { slug: string } }>('/subjects/:slug', async (req, reply) => {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT id, name, slug, icon, description, parent_id FROM categories WHERE slug = ?', [req.params.slug]);
    const category = rows[0];
    if (!category) return reply.code(404).send({ error: 'not_found' });
    const index = await loadCategoryIndex(db);
    const ids = index.descendants(category.id as number);
    const [children] = await db.query<RowDataPacket[]>('SELECT id, name, slug, icon FROM categories WHERE parent_id = ? ORDER BY position, name', [category.id]);
    const [[articles]] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM posts p WHERE ${VISIBLE_POST} AND p.book_id IS NULL AND p.category_id IN (?)`,
      [ids],
    );
    return {
      subject: {
        id: category.id as number,
        name: category.name as string,
        slug: category.slug as string,
        icon: (category.icon as string | null) ?? null,
        description: (category.description as string | null) ?? null,
        articles: Number(articles!.n),
      },
      children: children.map((child) => ({ id: child.id as number, name: child.name as string, slug: child.slug as string, icon: child.icon as string | null })),
      books: await publicBooks('AND bk.category_id IN (?)', [ids]),
    };
  });

  // ---------- Reading progress ----------

  // A signed-in reader's picture: what to read now, their journeys, their streak.
  app.get<{ Querystring: { today?: string } }>(
    '/reading',
    { preHandler: requireUser, schema: { querystring: { type: 'object', properties: { today: { type: 'string', maxLength: 10 } } } } },
    async (req) => {
      const { entries, days } = await storedReading(db, req.user!.id);
      return readingSummary(db, entries, days, todayOf(req.query.today), req.user);
    },
  );

  // The same for a guest, from what their browser kept (nothing is stored).
  app.post<{ Body: { entries: EntryBody[]; days?: string[]; today?: string } }>(
    '/reading/summary',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['entries'],
          properties: { entries: entriesSchema, days: daysSchema, today: { type: 'string', maxLength: 10 } },
        },
      },
    },
    async (req) => readingSummary(db, toEntries(req.body.entries), new Set(req.body.days ?? []), todayOf(req.body.today), req.user),
  );

  // How far a signed-in reader got in a post (the furthest point is kept), and that they read today.
  app.put<{ Params: { id: string }; Body: { progress: number; day?: string } }>(
    '/reading/:id',
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['progress'],
          additionalProperties: false,
          properties: { progress: { type: 'number', minimum: 0, maximum: 100 }, day: { type: 'string', maxLength: 10 } },
        },
      },
    },
    async (req, reply) => {
      const id = parseId(req.params.id) ?? 0;
      const [visible] = await db.query<RowDataPacket[]>(`SELECT p.id FROM posts p WHERE p.id = ? AND ${visibleTo(req.user)}`, [id]);
      if (!visible[0]) return reply.code(404).send({ error: 'not_found' });
      await saveProgress(db, req.user!.id, id, req.body.progress, validDay(req.body.day));
      return { ok: true };
    },
  );

  // A guest's progress, brought into the account they just signed in to.
  app.post<{ Body: { entries: EntryBody[]; days?: string[] } }>(
    '/reading/import',
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: { type: 'object', required: ['entries'], properties: { entries: entriesSchema, days: daysSchema } } },
    },
    async (req) => {
      const entries = toEntries(req.body.entries);
      if (entries.length) {
        const [visible] = await db.query<RowDataPacket[]>(`SELECT p.id FROM posts p WHERE p.id IN (?) AND ${VISIBLE_POST}`, [entries.map((e) => e.postId)]);
        const ok = new Set(visible.map((row) => row.id as number));
        for (const entry of entries.filter((e) => ok.has(e.postId))) {
          await saveProgress(db, req.user!.id, entry.postId, entry.finished ? 100 : entry.progress, null, entry.updatedAt);
        }
      }
      // Reading days of the last year, none in the future (a day ahead at most: time zones).
      const since = new Date(Date.now() - 366 * 86_400_000).toISOString().slice(0, 10);
      const until = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const days = (req.body.days ?? []).filter((day) => day >= since && day <= until);
      for (const day of days) await db.execute('INSERT IGNORE INTO reading_days (user_id, day) VALUES (?, ?)', [req.user!.id, day]);
      return { ok: true };
    },
  );

  // ---------- A writer's books: /u/{username}/carti ----------

  async function editableBook(req: { user: SessionUser | null }, id: number | null) {
    if (!id) return null;
    const [rows] = await db.query<RowDataPacket[]>(`${bookSelect()} WHERE bk.id = ? AND bk.deleted_at IS NULL`, [id]);
    const book = rows[0] ? toBook(rows[0]) : null;
    return book && canEditBook(req.user, book) ? book : null;
  }

  /** A book's fields as sent by the editor, checked. */
  async function prepareBook(body: BookBody) {
    const title = body.title.trim();
    if (title.length < 2) return { error: 'book_title_invalid' } as const;
    const categoryId = body.categoryId ?? null;
    if (categoryId) {
      const [rows] = await db.execute<RowDataPacket[]>('SELECT id FROM categories WHERE id = ?', [categoryId]);
      if (!rows[0]) return { error: 'category_invalid' } as const;
    }
    const cover = body.cover === undefined ? DEFAULT_COVER : cleanCover(body.cover);
    if (!cover) return { error: 'cover_invalid' } as const;
    return {
      title,
      description: body.description?.trim() ?? '',
      categoryId,
      cover,
      planned: body.plannedChapters ?? null,
      complete: body.complete === true,
      published: body.published,
    };
  }

  // The person's books. All of them (unpublished ones too), with their desk: theirs (/cartile-mele), and
  // administrators' (who write chapters in an author's name: the editor lists the author's books). Anyone's, when
  // they're public (/{username}/carti): the published ones. Else "private".
  app.get<{ Params: { username: string } }>('/u/:username/carti', async (req, reply) => {
    const person = await findPerson(db, req.params.username);
    if (!person) return reply.code(404).send({ error: 'not_found' });
    const manage = req.user?.id === person.id || req.user?.role === 'owner';
    if (!manage) {
      if (!isPublicList(person, 'carti')) return reply.code(403).send({ error: 'private' });
      const [published] = await db.query<RowDataPacket[]>(`${bookSelect()} WHERE bk.author_id = ? AND ${publicBook()} ORDER BY bk.updated_at DESC`, [person.id]);
      return { books: published.map(toBook), manage: false, desk: null };
    }
    const [rows] = await db.query<RowDataPacket[]>(`${bookSelect()} WHERE bk.author_id = ? AND bk.deleted_at IS NULL ORDER BY bk.updated_at DESC`, [
      person.id,
    ]);
    const books = rows.map(toBook);
    // Their desk (for them and administrators): the chapters still drafts, and the chapter they last worked on.
    const [[drafts]] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM posts p JOIN books bk ON bk.id = p.book_id
        WHERE bk.author_id = ? AND bk.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status = 'draft'`,
      [person.id],
    );
    const [last] = await db.query<RowDataPacket[]>(
      `SELECT p.id, p.title, p.chapter_no, p.status, p.published_at, p.updated_at, p.book_id FROM posts p JOIN books bk ON bk.id = p.book_id
        WHERE bk.author_id = ? AND bk.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY p.updated_at DESC, p.id DESC LIMIT 1`,
      [person.id],
    );
    const lastRow = last[0];
    const lastBook = lastRow ? books.find((book) => book.id === lastRow.book_id) : undefined;
    const publishedAt = (lastRow?.published_at as Date | null) ?? null;
    return {
      books,
      manage,
      desk: {
        drafts: Number(drafts!.n),
        /** The chapter they last saved, with its book. */
        last:
          lastRow && lastBook
            ? {
                book: lastBook,
                chapter: {
                  id: lastRow.id as number,
                  title: lastRow.title as string,
                  no: (lastRow.chapter_no as number | null) ?? 0,
                  state: lastRow.status === 'draft' ? 'draft' : publishedAt && publishedAt > new Date() ? 'scheduled' : 'published',
                  updatedAt: lastRow.updated_at as Date,
                },
              }
            : null,
      },
    };
  });

  app.post<{ Params: { username: string }; Body: BookBody }>(
    '/u/:username/carti',
    { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { body: bookBodySchema } },
    async (req, reply) => {
      const person = await findPerson(db, req.params.username);
      if (!person) return reply.code(404).send({ error: 'not_found' });
      const admin = req.user!.role === 'owner';
      if (req.user!.id !== person.id && !admin) return reply.code(403).send({ error: 'forbidden' });
      if (person.role !== 'author') return reply.code(admin ? 400 : 403).send({ error: admin ? 'author_required' : 'forbidden' });
      const book = await prepareBook(req.body);
      if ('error' in book) return reply.code(400).send(book);
      const slug = await uniqueSlug(db, 'books', book.title);
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO books (author_id, category_id, title, slug, description, cover, planned_chapters, completed_at, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [person.id, book.categoryId, book.title, slug, book.description, JSON.stringify(book.cover), book.planned, book.complete ? new Date() : null, book.published ? new Date() : null],
      );
      forgetThought();
      if (admin && req.user!.id !== person.id) void logAdmin(db, req.user!, 'book.create', { type: 'book', id: result.insertId, label: book.title }, { author: person.name });
      return { id: result.insertId, slug };
    },
  );

  // One book to edit: with all its chapters (drafts and scheduled ones too).
  app.get<{ Params: { username: string; id: string } }>('/u/:username/carti/:id', { preHandler: requireUser }, async (req, reply) => {
    const book = await editableBook(req, parseId(req.params.id));
    if (!book) return reply.code(404).send({ error: 'not_found' });
    return { book, contents: (await chaptersOf(db, [book.id], req.user)).get(book.id) ?? [] };
  });

  app.put<{ Params: { username: string; id: string }; Body: BookBody }>(
    '/u/:username/carti/:id',
    { preHandler: requireUser, schema: { body: bookBodySchema } },
    async (req, reply) => {
      const current = await editableBook(req, parseId(req.params.id));
      if (!current) return reply.code(404).send({ error: 'not_found' });
      const book = await prepareBook(req.body);
      if ('error' in book) return reply.code(400).send(book);
      // A new title gives a new address only while nobody could have its old one (no chapter public yet).
      const slug = current.chapters === 0 && book.title !== current.title ? await uniqueSlug(db, 'books', book.title, current.id) : current.slug;
      await db.execute(
        `UPDATE books SET category_id = ?, title = ?, slug = ?, description = ?, cover = ?, planned_chapters = ?,
                completed_at = IF(?, COALESCE(completed_at, UTC_TIMESTAMP()), NULL),
                published_at = IF(?, COALESCE(published_at, UTC_TIMESTAMP()), NULL), updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [
          book.categoryId,
          book.title,
          slug,
          book.description,
          JSON.stringify(book.cover),
          book.planned,
          book.complete ? 1 : 0,
          (book.published ?? current.published) ? 1 : 0,
          current.id,
        ],
      );
      // Its chapters (and their quotes) come and go with it.
      forgetThought();
      if (req.user!.role === 'owner' && current.author.id !== req.user!.id) {
        void logAdmin(db, req.user!, 'book.update', { type: 'book', id: current.id, label: book.title }, null, 30);
      }
      return { id: current.id, slug };
    },
  );

  // A book goes once it has no chapters (they're deleted, or moved out of it, first).
  app.delete<{ Params: { username: string; id: string } }>('/u/:username/carti/:id', { preHandler: requireUser }, async (req, reply) => {
    const book = await editableBook(req, parseId(req.params.id));
    if (!book) return reply.code(404).send({ error: 'not_found' });
    if (book.allChapters > 0) return reply.code(409).send({ error: 'book_not_empty' });
    await db.execute('UPDATE books SET deleted_at = UTC_TIMESTAMP() WHERE id = ?', [book.id]);
    if (req.user!.role === 'owner' && book.author.id !== req.user!.id) void logAdmin(db, req.user!, 'book.delete', { type: 'book', id: book.id, label: book.title });
    return { ok: true };
  });

  // The chapters' order: their numbers become 1, 2, 3... in the order given.
  app.put<{ Params: { username: string; id: string }; Body: { order: number[] } }>(
    '/u/:username/carti/:id/ordine',
    {
      preHandler: requireUser,
      schema: {
        body: {
          type: 'object',
          required: ['order'],
          additionalProperties: false,
          properties: { order: { type: 'array', maxItems: 999, items: { type: 'integer', minimum: 1 } } },
        },
      },
    },
    async (req, reply) => {
      const book = await editableBook(req, parseId(req.params.id));
      if (!book) return reply.code(404).send({ error: 'not_found' });
      const [rows] = await db.execute<RowDataPacket[]>('SELECT id FROM posts WHERE book_id = ? AND deleted_at IS NULL', [book.id]);
      const ids = new Set(rows.map((row) => row.id as number));
      const order = req.body.order;
      if (order.length !== ids.size || new Set(order).size !== order.length || !order.every((id) => ids.has(id))) {
        return reply.code(400).send({ error: 'order_invalid' });
      }
      for (const [index, id] of order.entries()) await db.execute('UPDATE posts SET chapter_no = ? WHERE id = ?', [index + 1, id]);
      if (req.user!.role === 'owner' && book.author.id !== req.user!.id) {
        void logAdmin(db, req.user!, 'book.reorder', { type: 'book', id: book.id, label: book.title }, { author: book.author.name }, 30);
      }
      return { contents: (await chaptersOf(db, [book.id], req.user)).get(book.id) ?? [] };
    },
  );

  // ---------- Saved cover designs (shared by the writers) ----------

  app.get('/cover-templates', { preHandler: requireWriter }, async (req) => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT t.id, t.name, t.design, t.created_by, u.name AS creator FROM cover_templates t LEFT JOIN users u ON u.id = t.created_by ORDER BY t.id`,
    );
    return {
      templates: rows.flatMap((row) => {
        const design = cleanCover(typeof row.design === 'string' ? JSON.parse(row.design) : row.design);
        if (!design) return [];
        return [
          {
            id: row.id as number,
            name: row.name as string,
            design,
            creator: (row.creator as string | null) ?? null,
            canDelete: req.user!.role === 'owner' || row.created_by === req.user!.id,
          },
        ];
      }),
    };
  });

  app.post<{ Body: { name: string; design: unknown } }>(
    '/cover-templates',
    {
      preHandler: requireWriter,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['name', 'design'],
          additionalProperties: false,
          properties: { name: { type: 'string', maxLength: 40 }, design: coverDesignSchema },
        },
      },
    },
    async (req, reply) => {
      const name = req.body.name.trim();
      if (!name) return reply.code(400).send({ error: 'template_name_invalid' });
      const design = cleanCover(req.body.design);
      if (!design) return reply.code(400).send({ error: 'cover_invalid' });
      delete design.template;
      const [result] = await db.execute<ResultSetHeader>(
        'INSERT INTO cover_templates (name, design, created_by, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())',
        [name, JSON.stringify(design), req.user!.id],
      );
      return { template: { id: result.insertId, name, design, creator: req.user!.name, canDelete: true } };
    },
  );

  // Books that used it keep their cover (each book stores its own design).
  app.delete<{ Params: { id: string } }>('/cover-templates/:id', { preHandler: requireWriter }, async (req, reply) => {
    const id = parseId(req.params.id) ?? 0;
    const [rows] = await db.execute<RowDataPacket[]>('SELECT name, created_by FROM cover_templates WHERE id = ?', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
    if (req.user!.role !== 'owner' && rows[0].created_by !== req.user!.id) return reply.code(403).send({ error: 'forbidden' });
    await db.execute('DELETE FROM cover_templates WHERE id = ?', [id]);
    if (rows[0].created_by !== req.user!.id) void logAdmin(db, req.user!, 'cover.delete', { type: 'book', id: null, label: rows[0].name as string });
    return { ok: true };
  });
};

export default bookRoutes;
