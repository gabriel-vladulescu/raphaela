import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronRight, LayoutGrid } from 'lucide-react';
import { useCategories } from '@/context/categories';
import { categoryPath } from '@/lib/categories';
import type { CategoryNode } from '@/lib/categories';
import { useI18n } from '@/lib/i18n';

/** Sidebar category tree on the home page; links filter the feed by ?category=slug. */
export function CategoryTree() {
  const { tree, categories, loaded } = useCategories();
  const { t } = useI18n();
  const [params] = useSearchParams();
  const activeSlug = params.get('category');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Keep the active category visible by expanding its ancestors.
  useEffect(() => {
    const active = categories.find((c) => c.slug === activeSlug);
    if (!active) return;
    setExpanded((current) => new Set([...current, ...categoryPath(categories, active.id).map((c) => c.id)]));
  }, [activeSlug, categories]);

  const linkTo = (slug: string | null) => {
    const next = new URLSearchParams(params);
    if (slug) next.set('category', slug);
    else next.delete('category');
    const search = next.toString();
    return search ? `/?${search}` : '/';
  };

  const toggle = (id: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const renderNode = (node: CategoryNode) => {
    const open = expanded.has(node.id);
    return (
      <li key={node.id}>
        <div className={`tree-row${node.slug === activeSlug ? ' is-active' : ''}`}>
          {node.children.length > 0 ? (
            <button
              type="button"
              className={`tree-toggle${open ? ' is-open' : ''}`}
              aria-expanded={open}
              aria-label={node.name}
              onClick={() => toggle(node.id)}
            >
              <ChevronRight size={15} />
            </button>
          ) : (
            <span className="tree-toggle-spacer" />
          )}
          <Link to={linkTo(node.slug)} className="tree-link" aria-current={node.slug === activeSlug ? 'page' : undefined}>
            <span className="tree-icon" aria-hidden="true">{node.icon || '•'}</span>
            <span className="tree-name">{node.name}</span>
            {node.totalPosts > 0 && <span className="tree-count">{node.totalPosts}</span>}
          </Link>
        </div>
        {open && node.children.length > 0 && <ul className="tree-children">{node.children.map(renderNode)}</ul>}
      </li>
    );
  };

  return (
    <nav className="category-tree" aria-label={t('categories.sidebarTitle')}>
      <h2 className="sidebar-title">{t('categories.sidebarTitle')}</h2>
      <div className={`tree-row${activeSlug ? '' : ' is-active'}`}>
        <span className="tree-toggle-spacer" />
        <Link to={linkTo(null)} className="tree-link" aria-current={activeSlug ? undefined : 'page'}>
          <span className="tree-icon" aria-hidden="true">
            <LayoutGrid size={15} />
          </span>
          <span className="tree-name">{t('categories.all')}</span>
        </Link>
      </div>
      {loaded && tree.length === 0 && <p className="muted small tree-empty">{t('categories.none')}</p>}
      <ul className="tree-root">{tree.map(renderNode)}</ul>
    </nav>
  );
}
