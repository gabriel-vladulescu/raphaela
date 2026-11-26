import type { FastifyPluginAsync } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { categoryLimits } from '@/config';
import { logAdmin } from '@/lib/adminLog';
import { loadCategoryIndex } from '@/lib/categories';
import { parseId, requireOwner } from '@/lib/guards';
import { VISIBLE_POST } from '@/lib/posts';
import { uniqueSlug } from '@/lib/slug';

interface CategoryBody {
  name: string;
  parentId: number | null;
  icon?: string | null;
  description?: string | null;
}

const categoryBodySchema = {
  type: 'object',
  required: ['name', 'parentId'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 80 },
    parentId: { type: ['integer', 'null'], minimum: 1 },
    icon: { type: ['string', 'null'], maxLength: 16 },
    description: { type: ['string', 'null'], maxLength: 500 },
  },
} as const;

const categoryRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get('/categories', async () => {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT c.id, c.parent_id, c.name, c.slug, c.icon, c.description, c.position,
              (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND ${VISIBLE_POST}) AS post_count
         FROM categories c ORDER BY c.position, c.id`,
    );
    return {
      categories: rows.map((row) => ({
        id: row.id,
        parentId: row.parent_id,
        name: row.name,
        slug: row.slug,
        icon: row.icon,
        description: row.description,
        postCount: Number(row.post_count),
      })),
      limits: categoryLimits,
    };
  });

  app.post<{ Body: CategoryBody }>(
    '/categories',
    { preHandler: requireOwner, schema: { body: categoryBodySchema } },
    async (req, reply) => {
      const name = req.body.name.trim();
      const { parentId } = req.body;
      if (!name) return reply.code(400).send({ error: 'name_invalid' });

      const index = await loadCategoryIndex(db);
      if (parentId !== null && !index.exists(parentId)) return reply.code(400).send({ error: 'category_invalid_parent' });
      if ((parentId === null ? 0 : index.depth(parentId)) + 1 > categoryLimits.maxDepth) {
        return reply.code(400).send({ error: 'category_too_deep' });
      }
      if (index.children(parentId).length >= categoryLimits.maxChildren) {
        return reply.code(400).send({ error: 'category_too_many_children' });
      }

      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO categories (parent_id, name, slug, icon, description, position)
         SELECT ?, ?, ?, ?, ?, COALESCE(MAX(position), 0) + 1 FROM categories WHERE parent_id <=> ?`,
        [parentId, name, await uniqueSlug(db, 'categories', name), req.body.icon?.trim() || null, req.body.description?.trim() || null, parentId],
      );
      void logAdmin(db, req.user!, 'category.create', { type: 'category', id: result.insertId, label: name });
      return { id: result.insertId };
    },
  );

  app.put<{ Params: { id: string }; Body: CategoryBody }>(
    '/categories/:id',
    { preHandler: requireOwner, schema: { body: categoryBodySchema } },
    async (req, reply) => {
      const id = parseId(req.params.id);
      const name = req.body.name.trim();
      const { parentId } = req.body;
      const index = await loadCategoryIndex(db);
      if (!id || !index.exists(id)) return reply.code(404).send({ error: 'not_found' });
      if (!name) return reply.code(400).send({ error: 'name_invalid' });

      const moving = parentId !== index.parentOf(id);
      if (moving) {
        // Can't move under itself or its own sub-categories.
        if (parentId !== null && (!index.exists(parentId) || index.descendants(id).includes(parentId))) {
          return reply.code(400).send({ error: 'category_invalid_parent' });
        }
        if ((parentId === null ? 0 : index.depth(parentId)) + index.height(id) > categoryLimits.maxDepth) {
          return reply.code(400).send({ error: 'category_too_deep' });
        }
        if (index.children(parentId).length >= categoryLimits.maxChildren) {
          return reply.code(400).send({ error: 'category_too_many_children' });
        }
      }

      const [[current]] = await db.execute<RowDataPacket[]>('SELECT name, slug FROM categories WHERE id = ?', [id]);
      const slug = current.name === name ? current.slug : await uniqueSlug(db, 'categories', name, id);
      await db.execute(
        `UPDATE categories SET name = ?, slug = ?, icon = ?, description = ? WHERE id = ?`,
        [name, slug, req.body.icon?.trim() || null, req.body.description?.trim() || null, id],
      );
      if (moving) {
        await db.execute(
          `UPDATE categories c
             JOIN (SELECT COALESCE(MAX(position), 0) + 1 AS next FROM categories WHERE parent_id <=> ?) s
              SET c.parent_id = ?, c.position = s.next
            WHERE c.id = ?`,
          [parentId, parentId, id],
        );
      }
      void logAdmin(db, req.user!, 'category.update', { type: 'category', id, label: name }, {
        ...(current.name !== name ? { renamedFrom: current.name } : {}),
        ...(moving ? { movedTo: parentId } : {}),
      });
      return { ok: true };
    },
  );

  // Swaps a category with its previous/next sibling.
  app.post<{ Params: { id: string }; Body: { direction: 'up' | 'down' } }>(
    '/categories/:id/move',
    {
      preHandler: requireOwner,
      schema: {
        body: {
          type: 'object',
          required: ['direction'],
          properties: { direction: { type: 'string', enum: ['up', 'down'] } },
        },
      },
    },
    async (req, reply) => {
      const id = parseId(req.params.id) ?? 0;
      const [[category]] = await db.execute<RowDataPacket[]>('SELECT name, parent_id, position FROM categories WHERE id = ?', [id]);
      if (!category) return reply.code(404).send({ error: 'not_found' });

      const up = req.body.direction === 'up';
      const [[sibling]] = await db.execute<RowDataPacket[]>(
        `SELECT id, position FROM categories
          WHERE parent_id <=> ? AND (position ${up ? '<' : '>'} ? OR (position = ? AND id ${up ? '<' : '>'} ?))
          ORDER BY position ${up ? 'DESC' : 'ASC'}, id ${up ? 'DESC' : 'ASC'} LIMIT 1`,
        [category.parent_id, category.position, category.position, id],
      );
      if (!sibling) return { ok: true };

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        // Positions can tie for rows created concurrently, so always end with distinct values.
        const [first, second] = up ? [sibling.position, sibling.position + 1] : [sibling.position, sibling.position - 1];
        await connection.execute('UPDATE categories SET position = ? WHERE id = ?', [first, id]);
        await connection.execute('UPDATE categories SET position = ? WHERE id = ?', [
          sibling.position === category.position ? second : category.position,
          sibling.id,
        ]);
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
      // Moved a few places in a row: one note.
      void logAdmin(db, req.user!, 'category.move', { type: 'category', id, label: category.name as string }, { direction: req.body.direction }, 10);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/categories/:id', { preHandler: requireOwner }, async (req, reply) => {
    const id = parseId(req.params.id) ?? 0;
    const [children] = await db.execute<RowDataPacket[]>('SELECT id FROM categories WHERE parent_id = ? LIMIT 1', [id]);
    if (children[0]) return reply.code(409).send({ error: 'category_has_children' });
    const [[gone]] = await db.execute<RowDataPacket[]>('SELECT name FROM categories WHERE id = ?', [id]);
    await db.execute('DELETE FROM categories WHERE id = ?', [id]); // its posts become uncategorized
    if (gone) void logAdmin(db, req.user!, 'category.delete', { type: 'category', id, label: gone.name as string });
    return { ok: true };
  });
};

export default categoryRoutes;
