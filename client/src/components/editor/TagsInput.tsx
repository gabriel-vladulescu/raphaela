import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { Tag } from '@/lib/types';

/** Mirrors MAX_TAGS in server/src/lib/tags.ts. */
const MAX_TAGS = 10;
const clean = (value: string) => value.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 40);

/**
 * A post's tags: typed and added with Enter or a comma, with the tags other posts use suggested as one types (the
 * same words make one tag, so readers find every post about them). Backspace in the empty field removes the last.
 */
export function TagsInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<Tag[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = clean(text);
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<{ tags: Tag[] }>(`/tags?q=${encodeURIComponent(q)}&limit=6`)
        .then((data) => {
          if (cancelled) return;
          const taken = new Set(value.map((tag) => tag.toLowerCase()));
          setSuggestions(data.tags.filter((tag) => !taken.has(tag.name.toLowerCase())));
          setActive(-1);
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, open, value]);

  function add(name: string) {
    const tag = clean(name);
    setText('');
    if (!tag || value.length >= MAX_TAGS || value.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return;
    onChange([...value, tag]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(active >= 0 && suggestions[active] ? suggestions[active].name : text);
    } else if (event.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    } else if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setActive((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const full = value.length >= MAX_TAGS;
  return (
    <div className="tags-input-wrap">
      <div className="tags-input input" onClick={() => inputRef.current?.focus()}>
        {value.map((tag) => (
          <span key={tag} className="tag-chip">
            #{tag}
            <button type="button" aria-label={t('editor.tagRemove', { tag })} onClick={() => onChange(value.filter((other) => other !== tag))}>
              <X size={12} />
            </button>
          </span>
        ))}
        {!full && (
          <input
            ref={inputRef}
            value={text}
            maxLength={41}
            placeholder={value.length ? '' : t('editor.tagsPlaceholder')}
            aria-label={t('editor.tags')}
            aria-autocomplete="list"
            aria-expanded={open && suggestions.length > 0}
            onChange={(event) => {
              const next = event.target.value;
              if (next.endsWith(',')) add(next.slice(0, -1));
              else setText(next);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // A suggestion's click lands first (mousedown keeps the focus).
              if (text.trim()) add(text);
              setOpen(false);
            }}
            onKeyDown={onKeyDown}
          />
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul className="tags-suggestions" role="listbox">
          {suggestions.map((tag, index) => (
            <li key={tag.slug} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={index === active ? 'is-active' : ''}
                onMouseDown={(event) => {
                  event.preventDefault();
                  add(tag.name);
                }}
              >
                #{tag.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="field-hint">{full ? t('editor.tagsFull', { n: MAX_TAGS }) : t('editor.tagsHint')}</span>
    </div>
  );
}
