import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, LoaderCircle, Minus, Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Dropdown } from '@/admin/Dropdown';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';

// The admin panel's building blocks (styles: admin.css, everything under .adm).

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="adm-pagehead">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="adm-muted">{subtitle}</p>}
      </div>
      {actions && <div className="adm-pagehead-actions">{actions}</div>}
    </div>
  );
}

export function Card(props: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`adm-card${props.flush ? ' is-flush' : ''} ${props.className ?? ''}`}>
      {(props.title || props.actions) && (
        <header className="adm-card-head">
          {props.title && <h2>{props.title}</h2>}
          {props.actions && <div className="adm-card-actions">{props.actions}</div>}
        </header>
      )}
      {props.children}
    </section>
  );
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent';

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`adm-badge is-${tone}`} title={title}>
      {children}
    </span>
  );
}

/** How a number changed from the period before: an arrow and the amount ("12%", or with `points`, the difference
 *  between two percentages, in percentage points). */
export function Delta({ now, before, points = false }: { now: number; before: number; points?: boolean }) {
  const { t, formatNumber } = useAdminI18n();
  if (!points && before === 0) {
    return now > 0 ? <span className="adm-delta is-up">{t('delta.new')}</span> : <span className="adm-delta is-flat">—</span>;
  }
  const change = points ? now - before : ((now - before) / before) * 100;
  const rounded = Math.round(change);
  const Icon = rounded > 0 ? ArrowUpRight : rounded < 0 ? ArrowDownRight : Minus;
  const tone = rounded > 0 ? 'is-up' : rounded < 0 ? 'is-down' : 'is-flat';
  const amount = `${formatNumber(Math.abs(rounded))}${points ? ' p.p.' : '%'}`;
  return (
    <span className={`adm-delta ${tone}`} title={t('delta.vsBefore')}>
      <Icon size={13} aria-hidden="true" />
      <span className="adm-visually-hidden">{rounded > 0 ? t('delta.up') : rounded < 0 ? t('delta.down') : t('delta.same')} </span>
      {amount}
    </span>
  );
}

/** A headline number: label, value, how it changed, and a small line of its days. */
export function Kpi(props: { icon: LucideIcon; label: string; value: string; delta?: ReactNode; note?: ReactNode; spark?: number[] }) {
  const Icon = props.icon;
  return (
    <div className="adm-kpi">
      <div className="adm-kpi-top">
        <span className="adm-kpi-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        <span className="adm-kpi-label">{props.label}</span>
      </div>
      <div className="adm-kpi-value">{props.value}</div>
      <div className="adm-kpi-foot">
        {props.delta}
        {props.note && <span className="adm-muted">{props.note}</span>}
      </div>
      {props.spark && props.spark.length > 1 && <Sparkline values={props.spark} />}
    </div>
  );
}

export function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 100;
  const h = 28;
  const step = w / Math.max(1, values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(2)},${(h - 2 - (v / max) * (h - 4)).toFixed(2)}`).join(' ');
  return (
    <svg className="adm-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export function Tabs<T extends string>({ items, value, onChange, label }: { items: TabItem<T>[]; value: T; onChange: (value: T) => void; label: string }) {
  const { formatNumber } = useAdminI18n();
  return (
    <div className="adm-tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button key={item.value} type="button" role="tab" aria-selected={item.value === value} className={item.value === value ? 'is-active' : ''} onClick={() => onChange(item.value)}>
          {item.label}
          {item.count !== undefined && <span className="adm-tab-count">{formatNumber(item.count)}</span>}
        </button>
      ))}
    </div>
  );
}

/** A search box that reports what's typed once typing pauses. */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const timer = window.setTimeout(() => onChange(text.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [text]);
  return (
    <label className="adm-search">
      <Search size={15} aria-hidden="true" />
      <input type="search" value={text} placeholder={placeholder} aria-label={placeholder} onChange={(event) => setText(event.target.value)} />
    </label>
  );
}

/** A menu of fixed choices (Dropdown, the panel's one style of menu). */
export function Select<T extends string>(props: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
  block?: boolean;
  align?: 'start' | 'end';
}) {
  return <Dropdown label={props.label} value={props.value} onChange={props.onChange} options={props.options} block={props.block} align={props.align} />;
}

export function Empty({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body?: string }) {
  return (
    <div className="adm-empty">
      <Icon size={28} aria-hidden="true" />
      <strong>{title}</strong>
      {body && <p className="adm-muted">{body}</p>}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  const { t } = useAdminI18n();
  return (
    <div className="adm-loading" role="status">
      <LoaderCircle size={18} className="adm-spin" aria-hidden="true" /> {label ?? t('common.loading')}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useAdminI18n();
  return (
    <div className="adm-error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="adm-btn is-small" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

/** Dialogs open now (one can open over another): the page stays locked until the last one closes. */
let openDialogs = 0;

/**
 * A dialog (or, with `drawer`, a panel from the right), on the native <dialog>: focus stays inside, Escape closes.
 * The page behind doesn't scroll while it's open.
 */
export function Dialog(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; drawer?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  /** Still on the page (its own closing, when it goes, isn't the browser's). */
  const shown = useRef(false);
  const { t } = useAdminI18n();
  useEffect(() => {
    const dialog = ref.current;
    shown.current = true;
    if (dialog && !dialog.open) dialog.showModal();
    openDialogs += 1;
    document.documentElement.classList.add('adm-locked');
    return () => {
      shown.current = false;
      dialog?.close();
      openDialogs -= 1;
      if (openDialogs === 0) document.documentElement.classList.remove('adm-locked');
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`adm-dialog${props.drawer ? ' is-drawer' : ''}${props.wide ? ' is-wide' : ''}`}
      aria-label={props.title}
      onCancel={(event) => {
        if (!event.cancelable) return; // the browser closes it regardless: see onClose
        event.preventDefault();
        props.onClose();
      }}
      // Browsers let a page keep a dialog open on Escape only once per click or tap: pressed again straight away, the
      // browser closes it itself. Then it's opened again at once, and closed the page's way.
      onClose={(event) => {
        const dialog = event.currentTarget;
        if (!shown.current || dialog.open) return;
        dialog.showModal();
        props.onClose();
      }}
      onClick={(event) => event.target === event.currentTarget && props.onClose()}
    >
      <div className="adm-dialog-box">
        <header className="adm-dialog-head">
          <h2>{props.title}</h2>
          <button type="button" className="adm-icon-btn" aria-label={t('common.close')} onClick={props.onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="adm-dialog-body">{props.children}</div>
        {props.footer && <footer className="adm-dialog-foot">{props.footer}</footer>}
      </div>
    </dialog>
  );
}

export function ConfirmDialog(props: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useAdminI18n();
  return (
    <Dialog
      title={props.title}
      onClose={props.onCancel}
      footer={
        <>
          <button type="button" className="adm-btn is-ghost" onClick={props.onCancel} disabled={props.busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className={`adm-btn ${props.danger ? 'is-danger' : 'is-primary'}`} onClick={props.onConfirm} disabled={props.busy}>
            {props.busy ? t('common.loading') : props.confirmLabel}
          </button>
        </>
      }
    >
      <div className="adm-confirm-body">{props.body}</div>
      {props.error && <p className="adm-form-error">{props.error}</p>}
    </Dialog>
  );
}

/** "Load more" under a list. */
export function LoadMore({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const { t } = useAdminI18n();
  return (
    <div className="adm-loadmore">
      <button type="button" className="adm-btn" disabled={busy} onClick={onClick}>
        {busy ? <LoaderCircle size={15} className="adm-spin" /> : null} {t('common.loadMore')}
      </button>
    </div>
  );
}

/** A label for a field, with an optional hint under it. */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="adm-field">
      <span className="adm-field-label">{label}</span>
      {children}
      {hint && <span className="adm-field-hint">{hint}</span>}
    </label>
  );
}

/** A period, from one day to another (both included; either open): the logs' filter, and what Clean up clears. */
export function PeriodFilter({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t } = useAdminI18n();
  return (
    <div className="adm-period" role="group" aria-label={t('period.label')}>
      <label>
        <span>{t('period.from')}</span>
        <input type="date" className="adm-input" value={from} max={to || undefined} onChange={(event) => onChange(event.target.value, to)} />
      </label>
      <label>
        <span>{t('period.to')}</span>
        <input type="date" className="adm-input" value={to} min={from || undefined} onChange={(event) => onChange(from, event.target.value)} />
      </label>
      {(from || to) && (
        <button type="button" className="adm-icon-btn" aria-label={t('period.clear')} title={t('period.clear')} onClick={() => onChange('', '')}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}

/** The period in the address, for an API query ("&from=…&to=…"). */
export const periodQuery = (params: URLSearchParams) =>
  ['from', 'to']
    .map((key) => {
      const value = params.get(key);
      return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `&${key}=${value}` : '';
    })
    .join('');

/** A translation key for a role. */
export const roleKey = (role: string) => `role.${role}` as AdminKey;

/** The clear-the-search button for a filter row's empty state. */
export function ClearFilters({ onClick }: { onClick: () => void }) {
  const { t } = useAdminI18n();
  return (
    <button type="button" className="adm-btn is-ghost is-small" onClick={onClick}>
      <X size={14} /> {t('common.clearFilters')}
    </button>
  );
}
