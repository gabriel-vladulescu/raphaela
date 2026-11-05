import type { Pool, RowDataPacket } from 'mysql2/promise';
import { VISIBLE_POST } from '@/lib/posts';
import { slugify } from '@/lib/slug';

// Tags: free words on posts, besides the category ("lună plină", "relații"). Each has its page (/eticheta/{slug}).

export const MAX_TAGS = 10;
const MAX_LENGTH = 60;

export interface Tag {
  name: string;
  slug: string;
}

/** The tags as typed, tidied: trimmed, single spaces, at most MAX_TAGS, one per slug (the first spelling wins). */
export function normalizeTags(names: string[]): Tag[] {
  const seen = new Map<string, Tag>();
  for (const raw of names) {
    const name = raw.replace(/\s+/g, ' ').trim().replace(/^#/, '').slice(0, MAX_LENGTH);
    const slug = slugify(name);
    if (!name || slug === 'item' || seen.has(slug)) continue;
    seen.set(slug, { name, slug });
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen.values()];
}

/** Gives a post exactly these tags (new ones are created; one already existing keeps its spelling). */
export async function setPostTags(db: Pool, postId: number, names: string[]) {
  const tags = normalizeTags(names);
  if (tags.length) {
    await db.query('INSERT IGNORE INTO tags (name, slug, created_at) VALUES ?', [tags.map((t) => [t.name, t.slug, new Date()])]);
  }
  const [rows] = tags.length
    ? await db.query<RowDataPacket[]>('SELECT id FROM tags WHERE slug IN (?)', [tags.map((t) => t.slug)])
    : [[] as RowDataPacket[]];
  const ids = rows.map((row) => row.id as number);
  await db.query(`DELETE FROM post_tags WHERE post_id = ?${ids.length ? ' AND tag_id NOT IN (?)' : ''}`, ids.length ? [postId, ids] : [postId]);
  if (ids.length) await db.query('INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES ?', [ids.map((id) => [postId, id])]);
}

/** Each post's tags, in name order. */
export async function tagsOf(db: Pool, postIds: number[]): Promise<Map<number, Tag[]>> {
  const map = new Map<number, Tag[]>();
  if (postIds.length === 0) return map;
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT pt.post_id, t.name, t.slug FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id IN (?) ORDER BY t.name',
    [postIds],
  );
  for (const row of rows) {
    const list = map.get(row.post_id as number) ?? [];
    list.push({ name: row.name as string, slug: row.slug as string });
    map.set(row.post_id as number, list);
  }
  return map;
}

/** Tags with their public posts, most used first (`q`: those whose name has it, for the editor's suggestions). */
export async function popularTags(db: Pool, q: string | undefined, limit: number) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT t.name, t.slug, COUNT(p.id) AS posts
       FROM tags t
       LEFT JOIN post_tags pt ON pt.tag_id = t.id
       LEFT JOIN posts p ON p.id = pt.post_id AND ${VISIBLE_POST}
      ${q ? 'WHERE t.name LIKE ? OR t.slug LIKE ?' : ''}
      GROUP BY t.id, t.name, t.slug
      ${q ? '' : 'HAVING posts > 0'}
      ORDER BY posts DESC, t.name
      LIMIT ?`,
    q ? [`%${q}%`, `%${slugify(q)}%`, limit] : [limit],
  );
  return rows.map((row) => ({ name: row.name as string, slug: row.slug as string, posts: Number(row.posts) }));
}
