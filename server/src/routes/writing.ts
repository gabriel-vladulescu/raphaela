import crypto from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { logAdmin } from '@/lib/adminLog';
import { forgetThought } from '@/lib/books';
import { parseId, requireUser } from '@/lib/guards';
import { findPerson } from '@/lib/people';
import { editablePost, findEditable, POST_COLUMNS, postBodySchema, postLabel, preparePost } from '@/lib/postEditing';
import type { PostBody } from '@/lib/postEditing';
import type { Kind } from '@/lib/posts';
import { getRevision, keepRevision, listRevisions } from '@/lib/revisions';
import { setPostTags, tagsOf } from '@/lib/tags';

interface Params {
  username: string;
  book?: string;
  id?: string;
}

type Req<Extra = object> = FastifyRequest<{ Params: Params } & Extra>;

/**
 * Writing, REST style, with the same editor: a person's articles under /u/{username}/articole, and the chapters of
 * one of their books under /u/{username}/carti/{book}/capitole. Each: POST a new one; GET, PUT, DELETE one; its
 * versions; its preview link. An article address never opens a chapter, nor the other way round. Posts belong to
 * authors: administrators write in an author's name, never their own.
 */
const writingRoutes: FastifyPluginAsync = async (app) => {
  register(app, 'post', '/u/:username/articole');
  register(app, 'chapter', '/u/:username/carti/:book/capitole');
};

function register(app: FastifyInstance, kind: Kind, base: string) {
  const { db } = app;
  const one = `${base}/:id`;

  /** For a new chapter: the book in the address, if it's the person's (not deleted). */
  async function bookOf(personId: number, id: string | undefined) {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT id FROM books WHERE id = ? AND author_id = ? AND deleted_at IS NULL', [parseId(id ?? '') ?? 0, personId]);
    return (rows[0]?.id as number | undefined) ?? null;
  }

  const editable = (req: Req) => findEditable(db, req.user, parseId(req.params.id ?? ''), kind);
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });

  // A new one, by its author, or by an administrator in an author's name.
  app.post<{ Params: Params; Body: PostBody }>(base, { preHandler: requireUser, schema: { body: postBodySchema } }, async (req, reply) => {
    const person = await findPerson(db, req.params.username);
    if (!person) return notFound(reply);
    const viewer = req.user!;
    const admin = viewer.role === 'owner';
    if (viewer.id !== person.id && !admin) return reply.code(403).send({ error: 'forbidden' });
    if (person.role !== 'author') return reply.code(admin ? 400 : 403).send({ error: admin ? 'author_required' : 'forbidden' });
    const bookId = kind === 'chapter' ? await bookOf(person.id, req.params.book) : null;
    if (kind === 'chapter' && !bookId) return reply.code(400).send({ error: 'book_invalid' });
    const prepared = await preparePost(db, req.body, person.id, undefined, bookId);
    if ('error' in prepared) return reply.code(400).send(prepared);
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO posts (author_id, ${POST_COLUMNS}) VALUES (?, ${prepared.values.map(() => '?').join(', ')})`,
      [person.id, ...prepared.values],
    );
    const [[row]] = await db.execute<RowDataPacket[]>('SELECT slug, title, book_id FROM posts WHERE id = ?', [result.insertId]);
    await setPostTags(db, result.insertId, req.body.tags ?? []);
    await db.execute('DELETE FROM post_redirects WHERE old_slug = ?', [row!.slug]);
    if (admin) void logAdmin(db, viewer, 'post.create', { type: 'post', id: result.insertId, label: postLabel(row!.title as string) }, { author: person.name });
    forgetThought();
    return { id: result.insertId, slug: row!.slug as string, username: person.username, bookId: (row!.book_id as number | null) ?? null };
  });

  // One, to edit (its author, or an administrator).
  app.get<{ Params: Params }>(one, { preHandler: requireUser }, async (req, reply) => {
    const row = await editable(req);
    if (!row) return notFound(reply);
    return { post: editablePost(row, (await tagsOf(db, [row.id as number])).get(row.id as number)) };
  });

  // Saves it. Administrators may give it to another author (authorId); one that isn't an author's (an
  // administrator's from before, or a former author's) must get one. A chapter goes with its book's author.
  app.put<{ Params: Params; Body: PostBody }>(one, { preHandler: requireUser, schema: { body: postBodySchema } }, async (req, reply) => {
    const post = await editable(req);
    if (!post) return notFound(reply);
    let authorId = post.author_id as number;
    if (req.body.authorId !== undefined && req.body.authorId !== authorId) {
      if (req.user!.role !== 'owner') return reply.code(403).send({ error: 'forbidden' });
      authorId = req.body.authorId;
    }
    const [authors] = await db.execute<RowDataPacket[]>('SELECT role, username FROM users WHERE id = ?', [authorId]);
    if (authors[0]?.role !== 'author') return reply.code(400).send({ error: 'author_required' });
    const id = post.id as number;
    const prepared = await preparePost(db, req.body, authorId, id, (post.book_id as number | null) ?? null);
    if ('error' in prepared) return reply.code(400).send(prepared);
    await keepRevision(db, id, req.user!.id, prepared.revision, req.body.restoredVersion === true);
    const assignments = POST_COLUMNS.split(', ').map((column) => `${column} = ?`).join(', ');
    await db.execute<ResultSetHeader>(`UPDATE posts SET ${assignments}, author_id = ? WHERE id = ?`, [...prepared.values, authorId, id]);
    const [[row]] = await db.execute<RowDataPacket[]>('SELECT slug, title, book_id FROM posts WHERE id = ?', [id]);
    if (req.body.tags !== undefined) await setPostTags(db, id, req.body.tags);
    // A new address: the old one keeps leading here (shared links, search engines), and nothing else leads from
    // the new one any more. (A draft was never public: nobody has its old address.)
    if (row!.slug !== post.slug && post.status !== 'draft') {
      await db.execute('INSERT INTO post_redirects (old_slug, post_id, created_at) VALUES (?, ?, UTC_TIMESTAMP()) AS new ON DUPLICATE KEY UPDATE post_id = new.post_id', [
        post.slug,
        id,
      ]);
    }
    await db.execute('DELETE FROM post_redirects WHERE old_slug = ?', [row!.slug]);
    // An administrator changing someone's post (once per half hour per post: saving often isn't news), or moving it.
    if (req.user!.role === 'owner') {
      if (authorId !== post.author_id) {
        void logAdmin(db, req.user!, 'post.author', { type: 'post', id, label: postLabel(row!.title as string) }, { from: post.author_id, to: authorId });
      } else if (post.author_id !== req.user!.id) {
        void logAdmin(db, req.user!, 'post.update', { type: 'post', id, label: postLabel(row!.title as string) }, null, 30);
      }
    }
    forgetThought();
    return { id, slug: row!.slug as string, username: authors[0]!.username as string, bookId: (row!.book_id as number | null) ?? null };
  });

  // A soft delete: it disappears for everyone but administrators, who still see it marked as deleted.
  app.delete<{ Params: Params }>(one, { preHandler: requireUser }, async (req, reply) => {
    const post = await editable(req);
    if (!post) return notFound(reply);
    await db.execute('UPDATE posts SET deleted_at = UTC_TIMESTAMP() WHERE id = ?', [post.id]);
    forgetThought();
    if (req.user!.role === 'owner' && post.author_id !== req.user!.id) {
      void logAdmin(db, req.user!, 'post.delete', { type: 'post', id: post.id as number, label: postLabel(post.title as string) });
    }
    return { ok: true };
  });

  // Its earlier versions (lib/revisions.ts), newest first; one of them in full, to compare or restore.
  app.get<{ Params: Params }>(`${one}/versions`, { preHandler: requireUser }, async (req, reply) => {
    const post = await editable(req);
    if (!post) return notFound(reply);
    return { versions: await listRevisions(db, post.id as number) };
  });

  app.get<{ Params: Params & { version: string } }>(`${one}/versions/:version`, { preHandler: requireUser }, async (req, reply) => {
    const post = await editable(req);
    const version = post ? await getRevision(db, post.id as number, parseId(req.params.version) ?? 0) : null;
    if (!version) return notFound(reply);
    return { version };
  });

  // A secret link to show it before it's public (/previzualizare/{token}); again: a new link (the old one stops
  // working). DELETE: no link.
  app.post<{ Params: Params }>(`${one}/preview`, { preHandler: requireUser }, async (req, reply) => {
    const post = await editable(req);
    if (!post) return notFound(reply);
    const token = crypto.randomBytes(16).toString('hex');
    await db.execute('UPDATE posts SET preview_token = ? WHERE id = ?', [token, post.id]);
    return { token };
  });

  app.delete<{ Params: Params }>(`${one}/preview`, { preHandler: requireUser }, async (req, reply) => {
    const post = await editable(req);
    if (!post) return notFound(reply);
    await db.execute('UPDATE posts SET preview_token = NULL WHERE id = ?', [post.id]);
    return { token: null };
  });
}

export default writingRoutes;
