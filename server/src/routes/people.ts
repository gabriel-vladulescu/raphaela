import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { parseId, requireOwner, requireUser } from '@/lib/guards';
import { findPerson } from '@/lib/people';
import { editablePost, findEditable, POST_COLUMNS, postBodySchema, preparePost } from '@/lib/postEditing';
import type { PostBody } from '@/lib/postEditing';
import { postSelect, toPostSummary, VISIBLE_POST, visibleTo } from '@/lib/posts';
import { profileSharePath } from '@/seo/og';

interface Params {
  username: string;
}

/**
 * A person's pages, REST style under /u/{username}: their articles (GET the list, POST a new one, GET / PUT / DELETE
 * one) and their saved ones (GET). Their articles and their saved posts are theirs to see (and administrators'),
 * and anyone's when they made them public (Settings). Posts belong to authors: administrators write in an author's
 * name, never their own.
 */
const peopleRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  // The person: what the pages show about them, and what this viewer may do there.
  app.get<{ Params: Params }>('/u/:username', async (req, reply) => {
    const person = await findPerson(db, req.params.username);
    if (!person) return reply.code(404).send({ error: 'not_found' });
    const me = req.user?.id === person.id;
    const [[counts]] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM posts p WHERE p.author_id = ? AND ${VISIBLE_POST}`, [person.id]);
    return {
      person: {
        username: person.username,
        name: person.name,
        picture: person.picture,
        role: person.role,
        occupation: person.occupation,
        quote: person.quote,
        publicArticles: person.publicArticles,
        publicSaved: person.publicSaved,
        articles: Number(counts!.n),
      },
      me,
      /** Their articles to manage: themselves, or an administrator. */
      manage: me || req.user?.role === 'owner',
      shareImages: { articole: profileSharePath(person, 'articole'), 'articole-salvate': profileSharePath(person, 'articole-salvate') },
    };
  });

  // The articles: to manage (all of them, drafts and scheduled ones too) for the person and administrators, who
  // also see deleted ones; an administrator's own list is every post (they write in authors' names). For anyone
  // else, the published ones, if the person made them public.
  app.get<{ Params: Params }>('/u/:username/articole', async (req, reply) => {
    const person = await findPerson(db, req.params.username);
    if (!person) return reply.code(404).send({ error: 'not_found' });
    const viewer = req.user;
    const me = viewer?.id === person.id;
    const admin = viewer?.role === 'owner';
    if (me && admin) {
      const [rows] = await db.query<RowDataPacket[]>(`${postSelect()} ORDER BY p.updated_at DESC`);
      return { posts: rows.map(toPostSummary), manage: true, everyone: true };
    }
    if (me || admin) {
      const [rows] = await db.query<RowDataPacket[]>(
        `${postSelect()} WHERE p.author_id = ? ${admin ? '' : 'AND p.deleted_at IS NULL'} ORDER BY p.updated_at DESC`,
        [person.id],
      );
      return { posts: rows.map(toPostSummary), manage: true, everyone: false };
    }
    if (!person.publicArticles) return reply.code(403).send({ error: 'private' });
    const [rows] = await db.query<RowDataPacket[]>(`${postSelect()} WHERE p.author_id = ? AND ${VISIBLE_POST} ORDER BY p.published_at DESC LIMIT 200`, [
      person.id,
    ]);
    return { posts: rows.map(toPostSummary), manage: false, everyone: false };
  });

  // A new article, by its author, or by an administrator in an author's name.
  app.post<{ Params: Params; Body: PostBody }>(
    '/u/:username/articole',
    { preHandler: requireUser, schema: { body: postBodySchema } },
    async (req, reply) => {
      const person = await findPerson(db, req.params.username);
      if (!person) return reply.code(404).send({ error: 'not_found' });
      const viewer = req.user!;
      const admin = viewer.role === 'owner';
      if (viewer.id !== person.id && !admin) return reply.code(403).send({ error: 'forbidden' });
      if (person.role !== 'author') return reply.code(admin ? 400 : 403).send({ error: admin ? 'author_required' : 'forbidden' });
      const prepared = await preparePost(db, req.body);
      if ('error' in prepared) return reply.code(400).send(prepared);
      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO posts (author_id, ${POST_COLUMNS}) VALUES (?, ${prepared.values.map(() => '?').join(', ')})`,
        [person.id, ...prepared.values],
      );
      const [[row]] = await db.execute<RowDataPacket[]>('SELECT slug FROM posts WHERE id = ?', [result.insertId]);
      return { id: result.insertId, slug: row!.slug as string, username: person.username };
    },
  );

  // One article, to edit (its author, or an administrator).
  app.get<{ Params: Params & { id: string } }>('/u/:username/articole/:id', { preHandler: requireUser }, async (req, reply) => {
    const row = await findEditable(db, req.user, parseId(req.params.id));
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { post: editablePost(row) };
  });

  // Saves an article. Administrators may give it to another author (authorId); a post that isn't an author's
  // (an administrator's from before, or a former author's) must get one.
  app.put<{ Params: Params & { id: string }; Body: PostBody }>(
    '/u/:username/articole/:id',
    { preHandler: requireUser, schema: { body: postBodySchema } },
    async (req, reply) => {
      const post = await findEditable(db, req.user, parseId(req.params.id));
      if (!post) return reply.code(404).send({ error: 'not_found' });
      let authorId = post.author_id as number;
      if (req.body.authorId !== undefined && req.body.authorId !== authorId) {
        if (req.user!.role !== 'owner') return reply.code(403).send({ error: 'forbidden' });
        authorId = req.body.authorId;
      }
      const [authors] = await db.execute<RowDataPacket[]>('SELECT role, username FROM users WHERE id = ?', [authorId]);
      if (authors[0]?.role !== 'author') return reply.code(400).send({ error: 'author_required' });
      const id = post.id as number;
      const prepared = await preparePost(db, req.body, id);
      if ('error' in prepared) return reply.code(400).send(prepared);
      const assignments = POST_COLUMNS.split(', ').map((column) => `${column} = ?`).join(', ');
      await db.execute<ResultSetHeader>(`UPDATE posts SET ${assignments}, author_id = ? WHERE id = ?`, [...prepared.values, authorId, id]);
      const [[row]] = await db.execute<RowDataPacket[]>('SELECT slug FROM posts WHERE id = ?', [id]);
      return { id, slug: row!.slug as string, username: authors[0]!.username as string };
    },
  );

  // A soft delete: the post disappears for everyone but administrators, who still see it marked as deleted.
  app.delete<{ Params: Params & { id: string } }>('/u/:username/articole/:id', { preHandler: requireUser }, async (req, reply) => {
    const post = await findEditable(db, req.user, parseId(req.params.id));
    if (!post) return reply.code(404).send({ error: 'not_found' });
    await db.execute('UPDATE posts SET deleted_at = UTC_TIMESTAMP() WHERE id = ?', [post.id]);
    return { ok: true };
  });

  // The posts they saved, most recent first: theirs to see, or anyone's if they made them public.
  app.get<{ Params: Params }>('/u/:username/articole-salvate', async (req, reply) => {
    const person = await findPerson(db, req.params.username);
    if (!person) return reply.code(404).send({ error: 'not_found' });
    const me = req.user?.id === person.id;
    // Administrators don't save posts: there's no list to show.
    if (person.role === 'owner' || (!me && !person.publicSaved)) return reply.code(403).send({ error: 'private' });
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
      "SELECT id, name, username, COALESCE(avatar_url, picture) AS picture FROM users WHERE role = 'author' ORDER BY name",
    );
    return {
      authors: rows.map((row) => ({ id: row.id as number, name: row.name as string, username: row.username as string, picture: row.picture as string | null })),
    };
  });

};

export default peopleRoutes;
