import type { Pool, RowDataPacket } from 'mysql2/promise';

/** In-memory view of the category tree (it's small), for depth/limit checks and descendant lookups. */
export async function loadCategoryIndex(db: Pool) {
  const [rows] = await db.query<RowDataPacket[]>('SELECT id, parent_id FROM categories');
  const parentOf = new Map<number, number | null>();
  const childrenOf = new Map<number | null, number[]>();
  for (const row of rows) {
    parentOf.set(row.id, row.parent_id);
    childrenOf.set(row.parent_id, [...(childrenOf.get(row.parent_id) ?? []), row.id]);
  }

  const children = (id: number | null) => childrenOf.get(id) ?? [];

  /** 1 for a top-level category, 2 for its children, ... */
  const depth = (id: number) => {
    let level = 0;
    for (let current: number | null = id; current !== null && level < 100; current = parentOf.get(current) ?? null) level++;
    return level;
  };

  /** Number of levels in the subtree rooted at `id` (1 for a leaf). */
  const height = (id: number): number => 1 + Math.max(0, ...children(id).map(height));

  const descendants = (id: number): number[] => [id, ...children(id).flatMap(descendants)];

  return { exists: (id: number) => parentOf.has(id), parentOf: (id: number) => parentOf.get(id) ?? null, children, depth, height, descendants };
}
