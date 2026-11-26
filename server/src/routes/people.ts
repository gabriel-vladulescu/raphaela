import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { requireOwner } from '@/lib/guards';
import { findPerson, isPublicList, PERSON_LISTS } from '@/lib/people';
import type { PersonList } from '@/lib/people';
import { publicBook } from '@/lib/books';
import { IS_POST, postSelect, toPostSummary, VISIBLE_POST, visibleTo } from '@/lib/posts';
import { profileSharePath } from '@/seo/og';

interface Params {
  username: string;
}

/**
 * A person's pages, REST style under /u/{username}: an author's journal (its articles: all of them for the author, to
 * manage at /jurnalul-meu; the published ones for anyone when the journal is public, /{username}/jurnal; writing them:
 * routes/writing.ts) and their saved posts (theirs, and anyone's when public). Their books: routes/books.ts.
 * Articles are posts, not their books' chapters (those are in the books). Each list is public by their choice
 * (Settings, lib/people.ts).
 */
const peopleRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  // The person: what the pages show about them, and what this viewer may do there.
  app.get<{ Params: Params }>('/u/:username', async (req, reply) => {
    const person = await findPerson(db, req.params.username);
    if (!person) return reply.code(404).send({ error: 'not_found' });
    const me = req.user?.id === person.id;
    const [[counts]] = await db.query<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM posts p WHERE p.author_id = ? AND ${IS_POST} AND ${VISIBLE_POST}) AS articles,
              (SELECT COUNT(*) FROM books bk WHERE bk.author_id = ? AND ${publicBook()}) AS books`,
      [person.id, person.id],
    );
    return {
      person: {
        username: person.username,
        name: person.name,
        picture: person.picture,
        role: person.role,
        occupation: person.occupation,
        quote: person.quote,
        publicArticles: person.publicArticles,
        publicBooks: person.publicBooks,
        publicSaved: person.publicSaved,
        articles: Number(counts!.articles),
        books: Number(counts!.books),
      },
      me,
      /** Their articles to manage: themselves, or an administrator. */
      manage: me || req.user?.role === 'owner',
      shareImages: Object.fromEntries(PERSON_LISTS.map((list) => [list, profileSharePath(person, list)])) as Record<PersonList, string>,
    };
  });

  // Their journal's articles. The author's own (/jurnalul-meu): all of them, to write and manage (drafts and scheduled
  // ones too), the last worked on first. Anyone's, when it's public (/{username}/jurnal): the published ones, newest
  // first. Else "private" (administrators have every post in the admin panel).
  app.get<{ Params: Params }>('/u/:username/articole', async (req, reply) => {
    const person = await findPerson(db, req.params.username);
    if (!person) return reply.code(404).send({ error: 'not_found' });
    if (req.user?.id === person.id && person.role === 'author') {
      const [rows] = await db.query<RowDataPacket[]>(
        `${postSelect()} WHERE p.author_id = ? AND ${IS_POST} AND p.deleted_at IS NULL ORDER BY p.updated_at DESC, p.id DESC`,
        [person.id],
      );
      return { posts: rows.map(toPostSummary), manage: true };
    }
    if (!isPublicList(person, 'jurnal')) return reply.code(403).send({ error: 'private' });
    const [rows] = await db.query<RowDataPacket[]>(
      `${postSelect()} WHERE p.author_id = ? AND ${IS_POST} AND ${VISIBLE_POST} ORDER BY p.published_at DESC, p.id DESC LIMIT 200`,
      [person.id],
    );
    return { posts: rows.map(toPostSummary), manage: false };
  });

  // What an author has scheduled, articles and chapters, in the order it comes out (the editor's "see what's
  // scheduled", picking a time), `limit` at a time from `offset` (the list loads more as it's scrolled), with how many
  // there are. Theirs, or for administrators (who schedule in an author's name).
  app.get<{ Params: Params; Querystring: { offset: number; limit: number } }>(
    '/u/:username/programate',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { offset: { type: 'integer', minimum: 0, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
        },
      },
    },
    async (req, reply) => {
      const person = await findPerson(db, req.params.username);
      if (!person) return reply.code(404).send({ error: 'not_found' });
      const own = req.user?.id === person.id && person.role === 'author';
      if (!own && req.user?.role !== 'owner') return reply.code(403).send({ error: 'forbidden' });
      const scheduled = `p.author_id = ? AND p.deleted_at IS NULL AND p.status = 'published' AND p.published_at > UTC_TIMESTAMP()`;
      const { offset, limit } = req.query;
      const [rows] = await db.query<RowDataPacket[]>(`${postSelect()} WHERE ${scheduled} ORDER BY p.published_at, p.id LIMIT ? OFFSET ?`, [person.id, limit + 1, offset]);
      const [[count]] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM posts p WHERE ${scheduled}`, [person.id]);
      return { posts: rows.slice(0, limit).map(toPostSummary), hasMore: rows.length > limit, total: Number(count!.n) };
    },
  );

  // The posts they saved, most recent first: theirs to see, or anyone's if they made them public.
  app.get<{ Params: Params }>('/u/:username/articole-salvate', async (req, reply) => {
    const person = await findPerson(db, req.params.username);
    if (!person) return reply.code(404).send({ error: 'not_found' });
    const me = req.user?.id === person.id;
    // Administrators don't save posts: there's no list to show.
    if (person.role === 'owner' || (!me && !isPublicList(person, 'salvate'))) return reply.code(403).send({ error: 'private' });
    const [rows] = await db.query<RowDataPacket[]>(
      `${postSelect()}
        WHERE p.id IN (SELECT b.post_id FROM post_bookmarks b WHERE b.user_id = ?) AND ${me ? visibleTo(req.user) : VISIBLE_POST}
        ORDER BY (SELECT b.created_at FROM post_bookmarks b WHERE b.user_id = ? AND b.post_id = p.id) DESC
        LIMIT 200`,
      [person.id, person.id],
    );
    return { posts: rows.map(toPostSummary) };
  });

  // Administrators: the authors they can write in the name of.
  app.get('/authors', { preHandler: requireOwner }, async () => {
    const [rows] = await db.query<RowDataPacket[]>(
      "SELECT id, name, username, COALESCE(avatar_url, picture) AS picture FROM users WHERE role = 'author' AND deleted_at IS NULL ORDER BY name",
    );
    return {
      authors: rows.map((row) => ({ id: row.id as number, name: row.name as string, username: row.username as string, picture: row.picture as string | null })),
    };
  });

};

export default peopleRoutes;
