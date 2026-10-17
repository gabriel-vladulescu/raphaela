import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowUp, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { CategorySelect } from '@/components/CategorySelect';
import { useCategories } from '@/context/categories';
import { api } from '@/lib/api';
import { descendantIds, subtreeHeight } from '@/lib/categories';
import type { CategoryNode } from '@/lib/categories';
import { useI18n } from '@/lib/i18n';

// ︎ asks for the text (not emoji) glyph, so symbols take the theme's colours.
const SYMBOLS = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '☉', '☽', '☿', '♀', '♂', '♃', '♄', '♅', '♆', '♇', '✦', '★', '☾', '⚹'].map(
  (glyph) => `${glyph}︎`,
);

interface CategoryValues {
  name: string;
  parentId: number | null;
  icon: string | null;
  description: string | null;
}

type Editing = { kind: 'new'; parentId: number | null } | { kind: 'edit'; node: CategoryNode } | null;

function CategoryForm(props: {
  initial: CategoryValues;
  editingNode?: CategoryNode;
  busy: boolean;
  onSubmit: (values: CategoryValues) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { limits } = useCategories();
  const [values, setValues] = useState(props.initial);
  const node = props.editingNode;
  const set = (patch: Partial<CategoryValues>) => setValues((current) => ({ ...current, ...patch }));

  return (
    <form
      className="category-form card"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit({ ...values, name: values.name.trim(), icon: values.icon || null, description: values.description?.trim() || null });
      }}
    >
      <div className="category-form-grid">
        <label className="field">
          <span className="field-label">{t('categoryAdmin.name')}</span>
          <input className="input" value={values.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} required autoFocus />
        </label>
        {node && (
          <label className="field">
            <span className="field-label">{t('categoryAdmin.parent')}</span>
            <CategorySelect
              value={values.parentId}
              onChange={(parentId) => set({ parentId })}
              emptyLabel={t('categoryAdmin.topLevel')}
              isDisabled={(option) =>
                descendantIds(node).includes(option.id) ||
                option.depth + subtreeHeight(node) > limits.maxDepth ||
                (option.id !== node.parentId && option.children.length >= limits.maxChildren)
              }
            />
          </label>
        )}
      </div>

      <div className="field">
        <span className="field-label">{t('categoryAdmin.icon')}</span>
        <div className="symbol-picker">
          {SYMBOLS.map((symbol) => (
            <button
              key={symbol}
              type="button"
              className={`symbol${values.icon === symbol ? ' is-selected' : ''}`}
              aria-pressed={values.icon === symbol}
              onClick={() => set({ icon: values.icon === symbol ? null : symbol })}
            >
              {symbol}
            </button>
          ))}
          <input
            className="input input-sm symbol-input"
            value={values.icon ?? ''}
            maxLength={8}
            placeholder="✧"
            aria-label={t('categoryAdmin.icon')}
            onChange={(e) => set({ icon: e.target.value })}
          />
        </div>
      </div>

      <label className="field">
        <span className="field-label">{t('categoryAdmin.description')}</span>
        <textarea className="input textarea" rows={2} maxLength={500} value={values.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
      </label>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={props.busy || !values.name.trim()}>
          {t('categoryAdmin.save')}
        </button>
      </div>
    </form>
  );
}

export function CategoriesPage() {
  const { tree, limits, loaded, reload } = useCategories();
  const { t, errorMessage } = useI18n();
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(values: CategoryValues) {
    if (!editing) return;
    const ok = await run(() =>
      editing.kind === 'new'
        ? api('/categories', { method: 'POST', body: values })
        : api(`/categories/${editing.node.id}`, { method: 'PUT', body: values }),
    );
    if (ok) setEditing(null);
  }

  const form = (initial: CategoryValues, editingNode?: CategoryNode) => (
    <CategoryForm key={editingNode?.id ?? `new-${initial.parentId}`} initial={initial} editingNode={editingNode} busy={busy} onSubmit={save} onCancel={() => setEditing(null)} />
  );

  const renderNode = (node: CategoryNode, index: number, siblings: CategoryNode[]) => {
    const childLimitReached = node.children.length >= limits.maxChildren;
    const isEditing = editing?.kind === 'edit' && editing.node.id === node.id;
    return (
      <li key={node.id}>
        <div className={`cat-row card${isEditing ? ' is-editing' : ''}`}>
          <span className="cat-icon" aria-hidden="true">{node.icon || '•'}</span>
          <div className="cat-info">
            <strong>{node.name}</strong>
            <span className="muted small">/{node.slug}{node.description ? ` · ${node.description}` : ''}</span>
          </div>
          <span className="count-pill" title={t('categoryAdmin.postCount')}>
            {node.totalPosts}
          </span>
          <div className="cat-actions">
            <button type="button" className="icon-btn" title={t('categoryAdmin.moveUp')} aria-label={t('categoryAdmin.moveUp')} disabled={busy || index === 0} onClick={() => run(() => api(`/categories/${node.id}/move`, { method: 'POST', body: { direction: 'up' } }))}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className="icon-btn" title={t('categoryAdmin.moveDown')} aria-label={t('categoryAdmin.moveDown')} disabled={busy || index === siblings.length - 1} onClick={() => run(() => api(`/categories/${node.id}/move`, { method: 'POST', body: { direction: 'down' } }))}>
              <ArrowDown size={16} />
            </button>
            {node.depth < limits.maxDepth && (
              <button
                type="button"
                className="icon-btn"
                title={childLimitReached ? t('categoryAdmin.limitReached', { n: limits.maxChildren }) : t('categoryAdmin.addChild')}
                aria-label={t('categoryAdmin.addChild')}
                disabled={busy || childLimitReached}
                onClick={() => setEditing({ kind: 'new', parentId: node.id })}
              >
                <FolderPlus size={16} />
              </button>
            )}
            <button type="button" className="icon-btn" title={t('categoryAdmin.edit')} aria-label={t('categoryAdmin.edit')} onClick={() => setEditing({ kind: 'edit', node })}>
              <Pencil size={16} />
            </button>
            <button
              type="button"
              className="icon-btn icon-btn-danger"
              title={node.children.length ? t('error.category_has_children') : t('categoryAdmin.delete')}
              aria-label={t('categoryAdmin.delete')}
              disabled={busy || node.children.length > 0}
              onClick={() => window.confirm(t('categoryAdmin.confirmDelete', { name: node.name })) && run(() => api(`/categories/${node.id}`, { method: 'DELETE' }))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {isEditing && form({ name: node.name, parentId: node.parentId, icon: node.icon, description: node.description }, node)}
        {(node.children.length > 0 || (editing?.kind === 'new' && editing.parentId === node.id)) && (
          <ul className="cat-children">
            {node.children.map((child, i, all) => renderNode(child, i, all))}
            {editing?.kind === 'new' && editing.parentId === node.id && <li>{form({ name: '', parentId: node.id, icon: null, description: null })}</li>}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="container">
      <HeaderBackLink to="/admin" label={t('admin.back')} />
      <section className="page-hero">
        <div className="page-hero-text">
          <h1>{t('categoryAdmin.title')}</h1>
          <p className="muted">{t('categoryAdmin.subtitle', { depth: limits.maxDepth, children: limits.maxChildren })}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={tree.length >= limits.maxChildren}
          title={tree.length >= limits.maxChildren ? t('categoryAdmin.limitReached', { n: limits.maxChildren }) : undefined}
          onClick={() => setEditing({ kind: 'new', parentId: null })}
        >
          <Plus size={17} /> {t('categoryAdmin.addRoot')}
        </button>
      </section>

      {error && <p className="form-error">{error}</p>}
      {editing?.kind === 'new' && editing.parentId === null && form({ name: '', parentId: null, icon: null, description: null })}

      {loaded && tree.length === 0 && !editing ? (
        <div className="empty-state card">
          <span className="empty-glyph" aria-hidden="true">✦</span>
          <p>{t('categoryAdmin.empty')}</p>
        </div>
      ) : (
        <ul className="cat-tree">{tree.map((node, i, all) => renderNode(node, i, all))}</ul>
      )}
    </div>
  );
}
