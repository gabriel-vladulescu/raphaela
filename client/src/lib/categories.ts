import type { Category } from '@/lib/types';

export interface CategoryNode extends Category {
  depth: number; // 1 = top level
  children: CategoryNode[];
  /** Published posts in this category and all its sub-categories. */
  totalPosts: number;
}

export function buildTree(categories: Category[]): CategoryNode[] {
  const nodes = new Map(categories.map((c) => [c.id, { ...c, depth: 1, children: [] as CategoryNode[], totalPosts: 0 }]));
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId === null ? undefined : nodes.get(node.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const finish = (node: CategoryNode, depth: number): number => {
    node.depth = depth;
    node.totalPosts = node.postCount + node.children.reduce((sum, child) => sum + finish(child, depth + 1), 0);
    return node.totalPosts;
  };
  roots.forEach((root) => finish(root, 1));
  return roots;
}

/** Depth-first list, e.g. for an indented <select>. */
export function flattenTree(nodes: CategoryNode[]): CategoryNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

/** The category and its ancestors, top level first (for breadcrumbs). */
export function categoryPath(categories: Category[], id: number): Category[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path: Category[] = [];
  for (let current = byId.get(id); current && path.length < 10; current = current.parentId ? byId.get(current.parentId) : undefined) {
    path.unshift(current);
  }
  return path;
}

/** Height of the subtree under `node` (1 for a leaf). */
export function subtreeHeight(node: CategoryNode): number {
  return 1 + Math.max(0, ...node.children.map(subtreeHeight));
}

export function descendantIds(node: CategoryNode): number[] {
  return [node.id, ...node.children.flatMap(descendantIds)];
}
