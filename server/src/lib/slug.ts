import type { Pool, RowDataPacket } from 'mysql2/promise';

/** "Horoscopul săptămânii" -> "horoscopul-saptamanii" */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (ă â î ș ț)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return slug || 'item';
}

/** Returns `base`'s slug, or the first free "-2", "-3", ... variant in the table. */
export async function uniqueSlug(db: Pool, table: 'posts' | 'categories' | 'series', base: string, excludeId = 0) {
  const slug = slugify(base);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT slug FROM ${table} WHERE (slug = ? OR slug LIKE ?) AND id <> ?`,
    [slug, `${slug}-%`, excludeId],
  );
  const taken = new Set(rows.map((row) => row.slug as string));
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) {
    if (!taken.has(`${slug}-${n}`)) return `${slug}-${n}`;
  }
}
