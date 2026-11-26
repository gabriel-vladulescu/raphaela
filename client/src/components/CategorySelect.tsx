import { useState } from 'react';
import { Check, ChevronDown, FolderTree, Search, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useCategories } from '@/context/categories';
import { categoryPath, flattenTree } from '@/lib/categories';
import type { CategoryNode } from '@/lib/categories';
import { useI18n } from '@/lib/i18n';
import { PHONE, useMediaQuery } from '@/lib/useMediaQuery';

interface CategorySelectProps {
  value: number | null;
  onChange: (id: number | null) => void;
  /** Label of the "no category" option. */
  emptyLabel: string;
  /** The picker's heading (default: "Category"; a book's: "Subject"). */
  title?: string;
  isDisabled?: (node: CategoryNode) => boolean;
  id?: string;
}

/** Lower case, without diacritics: "Mars" is found by "mars", "Café" by "cafe". */
const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * A category, picked from the tree: a field with the one chosen (its parents above it), which opens the picker (a
 * dialog on wide screens, the whole screen on phones) with a search. The editor's category, a book's subject.
 */
export function CategorySelect({ value, onChange, emptyLabel, title, isDisabled, id }: CategorySelectProps) {
  const { t } = useI18n();
  const { categories, tree } = useCategories();
  const [open, setOpen] = useState(false);
  const chosen = value ? flattenTree(tree).find((node) => node.id === value) : undefined;
  const parents = chosen ? categoryPath(categories, chosen.id).slice(0, -1) : [];
  const heading = title ?? t('editor.category');

  return (
    <>
      <button id={id} type="button" className="input category-field" aria-haspopup="dialog" aria-expanded={open} aria-label={`${heading}: ${chosen?.name ?? emptyLabel}`} onClick={() => setOpen(true)}>
        <span className="category-field-icon" aria-hidden="true">
          {chosen?.icon || <FolderTree size={16} />}
        </span>
        <span className="category-field-text">
          {parents.length > 0 && <span className="category-field-path">{parents.map((parent) => parent.name).join(' › ')}</span>}
          <span className={`category-field-name${chosen ? '' : ' is-empty'}`}>{chosen?.name ?? emptyLabel}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <CategoryPicker
          title={heading}
          value={value}
          emptyLabel={emptyLabel}
          isDisabled={isDisabled}
          onPick={(picked) => {
            onChange(picked);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** The categories: as a tree (none first), or, searched, those whose name has it, with their parents. A pick closes it. */
function CategoryPicker(props: {
  title: string;
  value: number | null;
  emptyLabel: string;
  isDisabled?: (node: CategoryNode) => boolean;
  onPick: (id: number | null) => void;
  onClose: () => void;
}) {
  const { title, value, emptyLabel, isDisabled, onPick, onClose } = props;
  const { t, formatNumber } = useI18n();
  const phone = useMediaQuery(PHONE);
  const { categories, tree } = useCategories();
  const [query, setQuery] = useState('');
  const all = flattenTree(tree);
  const words = plain(query).split(/\s+/).filter(Boolean);
  const found = words.length ? all.filter((node) => words.every((word) => plain(node.name).includes(word))) : all;
  const pathOf = (node: CategoryNode) =>
    categoryPath(categories, node.id)
      .slice(0, -1)
      .map((parent) => parent.name)
      .join(' › ');

  return (
    <Modal title={title} onClose={onClose} closeOnBackdrop className="category-picker">
      <div className="tag-picker-body">
        <div className="tag-picker-head">
          <h2>
            {title} <span className="muted">· {all.length}</span>
          </h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="tag-picker-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={t('categories.search')}
            aria-label={t('categories.search')}
            // On phones the keyboard would cover the list at once: there, search is a tap away.
            autoFocus={!phone}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="tag-picker-list category-picker-list" role="listbox" aria-label={title}>
          {!words.length && (
            <button type="button" role="option" aria-selected={value === null} className={`category-option is-none${value === null ? ' is-selected' : ''}`} onClick={() => onPick(null)}>
              <span className="category-option-icon" aria-hidden="true">
                –
              </span>
              <span className="category-option-text">
                <strong>{emptyLabel}</strong>
              </span>
              {value === null && <Check size={16} className="category-option-check" aria-hidden="true" />}
            </button>
          )}
          {found.map((node) => {
            const selected = node.id === value;
            const path = words.length ? pathOf(node) : '';
            return (
              <button
                key={node.id}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={isDisabled?.(node)}
                className={`category-option${selected ? ' is-selected' : ''}${node.depth === 1 && !words.length ? ' is-top' : ''}`}
                // As a tree: each level a step in.
                style={words.length ? undefined : { paddingLeft: `${12 + (node.depth - 1) * 22}px` }}
                onClick={() => onPick(node.id)}
              >
                <span className="category-option-icon" aria-hidden="true">
                  {node.icon || '•'}
                </span>
                <span className="category-option-text">
                  <strong>{node.name}</strong>
                  {path && <span className="muted">{path}</span>}
                </span>
                {node.totalPosts > 0 && <span className="category-option-count">{formatNumber(node.totalPosts)}</span>}
                {selected && <Check size={16} className="category-option-check" aria-hidden="true" />}
              </button>
            );
          })}
          {words.length > 0 && found.length === 0 && <p className="muted small category-none">{t('categories.noneFound', { q: query.trim() })}</p>}
        </div>
      </div>
    </Modal>
  );
}
