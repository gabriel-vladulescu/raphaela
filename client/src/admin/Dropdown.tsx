import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from 'react';
import { Check, ChevronDown, LoaderCircle, Search, X } from 'lucide-react';
import { useAdminI18n } from '@/admin/i18n';
import { Avatar } from '@/components/Avatar';

// The admin panel's menus: Dropdown (a fixed list, with a filter box when it's long) and SearchSelect (people or
// things from the database, searched on the server a few at a time). Both open a panel under the button, positioned
// on the screen (so a dialog's scrolling body doesn't cut it), and work with the keyboard.

export interface Option<T> {
  value: T;
  label: string;
  /** A second line (an email, a count). */
  hint?: string;
  /** A person's picture (an avatar is shown, with initials without one). */
  picture?: string | null;
  /** Indented this many levels (a tree, e.g. categories). */
  depth?: number;
  disabled?: boolean;
}

/** Where the panel goes: under the button, or above it when there's no room below. `fixedWidth`: the panel's own
 *  width (else at least the button's, 240px or more). */
export function usePanelPosition(trigger: RefObject<HTMLElement | null>, open: boolean, align: 'start' | 'end', fixedWidth?: number) {
  // Out of the page's flow and hidden until placed: in the flow, it would move the button it's measured from.
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' });
  const place = useCallback(() => {
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    const width = Math.min(fixedWidth ?? Math.max(box.width, 240), window.innerWidth - 16);
    const below = window.innerHeight - box.bottom;
    const up = below < 300 && box.top > below;
    const left = align === 'end' ? Math.max(8, box.right - width) : Math.min(Math.max(8, box.left), window.innerWidth - width - 8);
    setStyle({
      position: 'fixed',
      left,
      width,
      ...(up ? { bottom: window.innerHeight - box.top + 6 } : { top: box.bottom + 6 }),
      maxHeight: Math.max(180, Math.min(360, (up ? box.top : below) - 16)),
    });
  }, [trigger, align, fixedWidth]);
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);
  return style;
}

/** Closes on a click outside the button and the panel. */
export function useOutside(refs: RefObject<HTMLElement | null>[], open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (refs.some((ref) => ref.current?.contains(event.target as Node))) return;
      close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);
}

/** The panel's list: arrows move, Enter picks, Escape closes. */
function OptionList<T>(props: {
  id: string;
  options: Option<T>[];
  value: T | null;
  active: number;
  setActive: (index: number) => void;
  onPick: (option: Option<T>) => void;
  empty: ReactNode;
  footer?: ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${props.active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [props.active]);
  return (
    <ul ref={listRef} id={props.id} className="adm-dd-list" role="listbox">
      {props.options.length === 0 && <li className="adm-dd-empty">{props.empty}</li>}
      {props.options.map((option, index) => {
        const selected = option.value === props.value;
        return (
          <li
            key={String(option.value)}
            id={`${props.id}-${index}`}
            data-index={index}
            role="option"
            aria-selected={selected}
            aria-disabled={option.disabled || undefined}
            className={`adm-dd-option${index === props.active ? ' is-active' : ''}${selected ? ' is-selected' : ''}${option.disabled ? ' is-disabled' : ''}`}
            style={option.depth ? { paddingLeft: 12 + option.depth * 16 } : undefined}
            onPointerEnter={() => props.setActive(index)}
            onClick={() => !option.disabled && props.onPick(option)}
          >
            {option.picture !== undefined && <Avatar name={option.label} picture={option.picture} size={24} />}
            <span className="adm-dd-text">
              <span>{option.label}</span>
              {option.hint && <small>{option.hint}</small>}
            </span>
            {selected && <Check size={15} className="adm-dd-check" aria-hidden="true" />}
          </li>
        );
      })}
      {props.footer && <li className="adm-dd-footer">{props.footer}</li>}
    </ul>
  );
}

/** Arrow keys over the enabled options; Enter picks; Escape closes. */
function listKeys<T>(event: KeyboardEvent, options: Option<T>[], active: number, setActive: (i: number) => void, pick: (o: Option<T>) => void, close: () => void) {
  const step = (from: number, by: number) => {
    for (let i = from + by; i >= 0 && i < options.length; i += by) if (!options[i]!.disabled) return i;
    return from;
  };
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    setActive(step(active, 1));
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    setActive(step(active, -1));
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const option = options[active];
    if (option && !option.disabled) pick(option);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation(); // not the dialog around it
    close();
  }
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * A menu of fixed choices, in the admin panel's style (for every select). `searchable`: a filter box at the top, for
 * long lists. `block`: as wide as its container (in forms).
 */
export function Dropdown<T extends string | number>(props: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  searchable?: boolean;
  block?: boolean;
  align?: 'start' | 'end';
  disabled?: boolean;
}) {
  const { t } = useAdminI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const style = usePanelPosition(trigger, open, props.align ?? 'start');
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useOutside([trigger, panel], open, () => setOpen(false));

  const shown = query ? props.options.filter((o) => fold(`${o.label} ${o.hint ?? ''}`).includes(fold(query))) : props.options;
  const current = props.options.find((o) => o.value === props.value);

  function openMenu() {
    setQuery('');
    setActive(Math.max(0, props.options.findIndex((o) => o.value === props.value)));
    setOpen(true);
  }
  const pick = (option: Option<T>) => {
    props.onChange(option.value);
    close();
  };

  return (
    <div className={`adm-dd${props.block ? ' is-block' : ''}`}>
      <button
        ref={trigger}
        type="button"
        className="adm-dd-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.label}
        title={props.label}
        disabled={props.disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            openMenu();
          } else if (open && !props.searchable) listKeys(event, shown, active, setActive, pick, close);
        }}
      >
        {current?.picture !== undefined && current && <Avatar name={current.label} picture={current.picture} size={20} />}
        <span className="adm-dd-value">{current?.label ?? '—'}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div ref={panel} className="adm-dd-panel" style={style}>
          {props.searchable && (
            <label className="adm-dd-search">
              <Search size={14} aria-hidden="true" />
              <input
                autoFocus
                value={query}
                placeholder={t('common.search')}
                aria-label={t('common.search')}
                aria-controls={id}
                aria-activedescendant={shown[active] ? `${id}-${active}` : undefined}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => listKeys(event, shown, active, setActive, pick, close)}
              />
            </label>
          )}
          <OptionList id={id} options={shown} value={props.value} active={active} setActive={setActive} onPick={pick} empty={t('common.noResults')} />
        </div>
      )}
    </div>
  );
}

export interface SearchResult<T> {
  options: Option<T>[];
  hasMore: boolean;
}

/**
 * A menu whose choices come from the database: what's typed is searched on the server, `limit` at a time (with
 * "refine the search" past that). `selected`: the current choice as an option (its label), null for none. `clear`:
 * the label of the "no choice" entry at the top (e.g. "All authors"); without it there's none.
 */
export function SearchSelect<T extends string | number>(props: {
  label: string;
  /** Shown on the button with nothing picked. */
  placeholder: string;
  /** In the search box. */
  searchPlaceholder: string;
  selected: Option<T> | null;
  load: (query: string, limit: number) => Promise<SearchResult<T>>;
  onChange: (option: Option<T> | null) => void;
  clear?: string;
  limit?: number;
  block?: boolean;
  align?: 'start' | 'end';
}) {
  const { t } = useAdminI18n();
  const id = useId();
  const limit = props.limit ?? 8;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult<T> | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const style = usePanelPosition(trigger, open, props.align ?? 'start');
  useOutside([trigger, panel], open, () => setOpen(false));
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  // Searches as typing pauses (at once when the menu opens).
  useEffect(() => {
    if (!open) return;
    const id = ++request.current;
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        setFailed(false);
        props
          .load(query.trim(), limit)
          .then((found) => id === request.current && setResult(found))
          .catch(() => id === request.current && setFailed(true))
          .finally(() => id === request.current && setLoading(false));
      },
      query ? 250 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const clearOption: Option<T | null>[] = props.clear && !query ? [{ value: null, label: props.clear }] : [];
  const options = [...clearOption, ...(result?.options ?? [])] as Option<T | null>[];
  const pick = (option: Option<T | null>) => {
    props.onChange(option.value === null ? null : (option as Option<T>));
    close();
  };

  return (
    <div className={`adm-dd${props.block ? ' is-block' : ''}`}>
      <button
        ref={trigger}
        type="button"
        className={`adm-dd-trigger${props.selected ? '' : ' is-placeholder'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.label}
        title={props.label}
        onClick={() => {
          if (open) return setOpen(false);
          setQuery('');
          setActive(0);
          setOpen(true);
        }}
      >
        {props.selected?.picture !== undefined && props.selected && <Avatar name={props.selected.label} picture={props.selected.picture} size={20} />}
        <span className="adm-dd-value">{props.selected?.label ?? props.placeholder}</span>
        {props.selected && props.clear ? (
          <span
            role="button"
            tabIndex={-1}
            className="adm-dd-clear"
            aria-label={props.clear}
            title={props.clear}
            onClick={(event) => {
              event.stopPropagation();
              props.onChange(null);
            }}
          >
            <X size={14} />
          </span>
        ) : (
          <ChevronDown size={16} aria-hidden="true" />
        )}
      </button>
      {open && (
        <div ref={panel} className="adm-dd-panel" style={style}>
          <label className="adm-dd-search">
            {loading ? <LoaderCircle size={14} className="adm-spin" aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
            <input
              autoFocus
              value={query}
              placeholder={props.searchPlaceholder}
              aria-label={props.searchPlaceholder}
              aria-controls={id}
              aria-activedescendant={options[active] ? `${id}-${active}` : undefined}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => listKeys(event, options, active, setActive, pick, close)}
            />
          </label>
          <OptionList
            id={id}
            options={options}
            value={props.selected?.value ?? null}
            active={active}
            setActive={setActive}
            onPick={pick}
            empty={failed ? t('common.loadFailed') : result ? t('common.noResults') : t('common.loading')}
            footer={result?.hasMore ? t('common.refine', { n: limit }) : undefined}
          />
        </div>
      )}
    </div>
  );
}
