import { useState } from 'react';
import { ArrowDown, ArrowUp, FolderPlus, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { Dropdown } from '@/admin/Dropdown';
import { useAdminI18n } from '@/admin/i18n';
import { TagsCard } from '@/admin/pages/Tags';
import { Card, ConfirmDialog, Dialog, Empty, Field, Loading, PageHead } from '@/admin/ui';
import { useCategories } from '@/context/categories';
import { api } from '@/lib/api';
import { descendantIds, flattenTree, subtreeHeight } from '@/lib/categories';
import type { CategoryNode } from '@/lib/categories';

// ︎ asks for the text (not emoji) glyph, so symbols take the theme's colours.
const SYMBOLS = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '☉', '☽', '☿', '♀', '♂', '♃', '♄', '♅', '♆', '♇', '✦', '★', '☾', '⚹'].map(
  (glyph) => `${glyph}︎`,
);

interface Values {
  name: string;
  parentId: number | null;
  icon: string | null;
  description: string | null;
}

type Editing = { kind: 'new'; parentId: number | null } | { kind: 'edit'; node: CategoryNode };

/** The categories' tree (up to the limits of depth and children): add, rename, move, nest, delete. Then the tags. */
export function CategoriesPage() {
  const { t, errorMessage, formatNumber } = useAdminI18n();
  const { tree, limits, loaded, reload } = useCategories();
  const { refreshOverview } = useAdmin();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<CategoryNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await reload();
      refreshOverview();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const move = (node: CategoryNode, direction: 'up' | 'down') => run(() => api(`/categories/${node.id}/move`, { method: 'POST', body: { direction } }));

  const renderNode = (node: CategoryNode, index: number, siblings: CategoryNode[]) => {
    const full = node.children.length >= limits.maxChildren;
    return (
      <li key={node.id}>
        <div className="adm-cat">
          <span className="adm-cat-icon" aria-hidden="true">
            {node.icon || '•'}
          </span>
          <div className="adm-cat-info">
            <strong>{node.name}</strong>
            <span className="adm-muted adm-small">
              /{node.slug}
              {node.description ? ` · ${node.description}` : ''}
            </span>
          </div>
          <span className="adm-count" title={t('categories.posts')}>
            {formatNumber(node.totalPosts)}
          </span>
          <div className="adm-row-actions">
            <button type="button" className="adm-icon-btn" title={t('categories.up')} aria-label={t('categories.up')} disabled={busy || index === 0} onClick={() => void move(node, 'up')}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className="adm-icon-btn" title={t('categories.down')} aria-label={t('categories.down')} disabled={busy || index === siblings.length - 1} onClick={() => void move(node, 'down')}>
              <ArrowDown size={16} />
            </button>
            {node.depth < limits.maxDepth && (
              <button
                type="button"
                className="adm-icon-btn"
                title={full ? t('categories.limit', { n: limits.maxChildren }) : t('categories.addChild')}
                aria-label={t('categories.addChild')}
                disabled={busy || full}
                onClick={() => setEditing({ kind: 'new', parentId: node.id })}
              >
                <FolderPlus size={16} />
              </button>
            )}
            <button type="button" className="adm-icon-btn" title={t('categories.edit')} aria-label={t('categories.edit')} onClick={() => setEditing({ kind: 'edit', node })}>
              <Pencil size={16} />
            </button>
            <button
              type="button"
              className="adm-icon-btn is-danger"
              title={node.children.length ? t('categories.hasChildren') : t('categories.delete')}
              aria-label={t('categories.delete')}
              disabled={busy || node.children.length > 0}
              onClick={() => setDeleting(node)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        {node.children.length > 0 && <ul className="adm-cat-children">{node.children.map((child, i, all) => renderNode(child, i, all))}</ul>}
      </li>
    );
  };

  return (
    <>
      <PageHead
        title={t('nav.categories')}
        subtitle={t('categories.subtitle', { depth: limits.maxDepth, children: limits.maxChildren })}
        actions={
          <button
            type="button"
            className="adm-btn is-primary"
            disabled={tree.length >= limits.maxChildren}
            title={tree.length >= limits.maxChildren ? t('categories.limit', { n: limits.maxChildren }) : undefined}
            onClick={() => setEditing({ kind: 'new', parentId: null })}
          >
            <Plus size={16} /> {t('categories.add')}
          </button>
        }
      />
      {error && !editing && <p className="adm-form-error">{error}</p>}
      <Card>
        {!loaded ? (
          <Loading />
        ) : tree.length === 0 ? (
          <Empty icon={FolderTree} title={t('categories.none')} />
        ) : (
          <ul className="adm-cats">{tree.map((node, i, all) => renderNode(node, i, all))}</ul>
        )}
      </Card>

      <TagsCard />

      {editing && (
        <CategoryDialog
          key={editing.kind === 'edit' ? editing.node.id : `new-${editing.parentId}`}
          editing={editing}
          busy={busy}
          error={error}
          onCancel={() => {
            setEditing(null);
            setError('');
          }}
          onSave={async (values) => {
            const ok = await run(() =>
              editing.kind === 'new' ? api('/categories', { method: 'POST', body: values }) : api(`/categories/${editing.node.id}`, { method: 'PUT', body: values }),
            );
            if (ok) setEditing(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('categories.delete')}
          body={t('categories.deleteBody', { name: deleting.name })}
          confirmLabel={t('categories.delete')}
          danger
          busy={busy}
          error={error}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            if (await run(() => api(`/categories/${deleting.id}`, { method: 'DELETE' }))) setDeleting(null);
          }}
        />
      )}
    </>
  );
}

function CategoryDialog(props: { editing: Editing; busy: boolean; error: string; onCancel: () => void; onSave: (values: Values) => void }) {
  const { t } = useAdminI18n();
  const { tree, limits } = useCategories();
  const node = props.editing.kind === 'edit' ? props.editing.node : null;
  const [values, setValues] = useState<Values>(
    node ? { name: node.name, parentId: node.parentId, icon: node.icon, description: node.description } : { name: '', parentId: props.editing.kind === 'new' ? props.editing.parentId : null, icon: null, description: null },
  );
  const set = (patch: Partial<Values>) => setValues((current) => ({ ...current, ...patch }));
  const options = flattenTree(tree);
  const newIn = props.editing.kind === 'new' ? props.editing.parentId : null;
  const parentName = newIn ? options.find((o) => o.id === newIn)?.name : null;

  return (
    <Dialog
      title={node ? t('categories.edit') : parentName ? t('categories.addIn', { name: parentName }) : t('categories.add')}
      onClose={props.onCancel}
      footer={
        <>
          <button type="button" className="adm-btn is-ghost" onClick={props.onCancel} disabled={props.busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="adm-btn is-primary"
            disabled={props.busy || !values.name.trim()}
            onClick={() => props.onSave({ ...values, name: values.name.trim(), icon: values.icon || null, description: values.description?.trim() || null })}
          >
            {props.busy ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <Field label={t('categories.name')}>
        <input className="adm-input" value={values.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} autoFocus />
      </Field>
      {node && (
        <Field label={t('categories.parent')}>
          <Dropdown<number>
            block
            searchable
            label={t('categories.parent')}
            value={values.parentId ?? 0}
            onChange={(id) => set({ parentId: id || null })}
            options={[
              { value: 0, label: t('categories.top') },
              ...options.map((option) => ({
                value: option.id,
                label: `${option.icon ? `${option.icon} ` : ''}${option.name}`,
                depth: option.depth,
                disabled:
                  descendantIds(node).includes(option.id) ||
                  option.depth + subtreeHeight(node) > limits.maxDepth ||
                  (option.id !== node.parentId && option.children.length >= limits.maxChildren),
              })),
            ]}
          />
        </Field>
      )}
      <div className="adm-field">
        <span className="adm-field-label">{t('categories.icon')}</span>
        <div className="adm-symbols">
          {SYMBOLS.map((symbol) => (
            <button key={symbol} type="button" className={`adm-symbol${values.icon === symbol ? ' is-active' : ''}`} aria-pressed={values.icon === symbol} onClick={() => set({ icon: values.icon === symbol ? null : symbol })}>
              {symbol}
            </button>
          ))}
          <input className="adm-input is-symbol" value={values.icon ?? ''} maxLength={8} placeholder="✧" aria-label={t('categories.icon')} onChange={(e) => set({ icon: e.target.value })} />
        </div>
      </div>
      <Field label={t('categories.description')}>
        <textarea className="adm-input" rows={2} maxLength={500} value={values.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      {props.error && <p className="adm-form-error">{props.error}</p>}
    </Dialog>
  );
}
