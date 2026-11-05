import { useLayoutEffect, useRef, useState } from 'react';
import { useAdminI18n } from '@/admin/i18n';

// The admin panel's charts, in SVG. Colours are roles from admin.css (--adm-s1… for series, ink and grid tokens),
// stepped separately for the light and dark themes. Every chart has a hover/touch readout and a table for screen
// readers.

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.floor(entries[0]!.contentRect.width)));
    observer.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A round top for the y axis (1, 2, 2.5 or 5 times a power of ten), and its ticks. */
function niceScale(max: number, count = 4) {
  if (max <= 0) return { top: count, ticks: Array.from({ length: count + 1 }, (_, i) => i) };
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const top = Math.ceil(max / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

export interface DayPoint {
  day: string;
  views: number;
  visitors: number;
}

/** Views and visitors per day: two lines on one scale (views with a soft area), a crosshair readout on hover. */
export function TrafficChart({ days, height = 240 }: { days: DayPoint[]; height?: number }) {
  const { t, formatNumber, locale } = useAdminI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 12, right: 12, bottom: 26, left: 44 };
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const { top, ticks } = niceScale(Math.max(0, ...days.map((d) => Math.max(d.views, d.visitors))));
  const x = (i: number) => pad.left + (days.length <= 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const dayLabel = (day: string, long = false) =>
    new Intl.DateTimeFormat(locale, { ...(long ? { weekday: 'short', month: 'long' } : { month: 'short' }), day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${day}T12:00:00Z`),
    );
  const line = (key: 'views' | 'visitors') => days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('');
  const area = days.length ? `${line('views')}L${x(days.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(innerW / 70))));
  // Every few days, and the last one (a regular label too close to it is left out).
  const labelled = (i: number) => i === days.length - 1 || (i % labelEvery === 0 && days.length - 1 - i >= labelEvery * 0.75);
  const totals = { views: days.reduce((sum, d) => sum + d.views, 0) };

  function pick(clientX: number, target: SVGSVGElement) {
    const box = target.getBoundingClientRect();
    const rel = clientX - box.left - pad.left;
    const i = days.length <= 1 ? 0 : Math.round((rel / innerW) * (days.length - 1));
    setHover(Math.min(days.length - 1, Math.max(0, i)));
  }

  const point = hover === null ? null : days[hover];
  return (
    <div className="adm-chart">
      <div className="adm-legend">
        <span className="adm-legend-item">
          <i className="adm-swatch is-s1" aria-hidden="true" /> {t('stats.views')}
        </span>
        <span className="adm-legend-item">
          <i className="adm-swatch is-s2" aria-hidden="true" /> {t('stats.visitorsDaily')}
        </span>
      </div>
      <div ref={ref} className="adm-chart-plot" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={t('stats.trafficAria', { views: totals.views })}
            onPointerMove={(event) => pick(event.clientX, event.currentTarget)}
            onPointerDown={(event) => pick(event.clientX, event.currentTarget)}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="adm-gridline" x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
                <text className="adm-axis" x={pad.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                  {formatNumber(tick)}
                </text>
              </g>
            ))}
            <line className="adm-baseline" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} />
            {days.map((d, i) =>
              labelled(i) ? (
                <text key={d.day} className="adm-axis" x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}>
                  {dayLabel(d.day)}
                </text>
              ) : null,
            )}
            <path className="adm-area is-s1" d={area} />
            <path className="adm-line is-s2" d={line('visitors')} />
            <path className="adm-line is-s1" d={line('views')} />
            {point && hover !== null && (
              <g>
                <line className="adm-crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={y(0)} />
                <circle className="adm-dot is-s2" cx={x(hover)} cy={y(point.visitors)} r={4.5} />
                <circle className="adm-dot is-s1" cx={x(hover)} cy={y(point.views)} r={4.5} />
              </g>
            )}
          </svg>
        )}
        {point && hover !== null && (
          <div className={`adm-tooltip${x(hover) > width / 2 ? ' is-left' : ''}`} style={{ left: x(hover) }}>
            <strong>{dayLabel(point.day, true)}</strong>
            <span>
              <i className="adm-swatch is-s1" aria-hidden="true" /> {t('stats.views')} <b>{formatNumber(point.views)}</b>
            </span>
            <span>
              <i className="adm-swatch is-s2" aria-hidden="true" /> {t('stats.visitors')} <b>{formatNumber(point.visitors)}</b>
            </span>
          </div>
        )}
      </div>
      <table className="adm-visually-hidden">
        <caption>{t('stats.traffic')}</caption>
        <thead>
          <tr>
            <th>{t('stats.day')}</th>
            <th>{t('stats.views')}</th>
            <th>{t('stats.visitors')}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.views}</td>
              <td>{d.visitors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface BarRow {
  key: string;
  label: string;
  value: number;
  note?: string;
}

/** Horizontal bars, one hue, biggest first; the first `shown` rows, the rest behind "show all". */
export function BarList({ rows, shown = 6, empty }: { rows: BarRow[]; shown?: number; empty: string }) {
  const { t, formatNumber } = useAdminI18n();
  const [all, setAll] = useState(false);
  if (rows.length === 0) return <p className="adm-muted adm-small">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const visible = all ? rows : rows.slice(0, shown);
  return (
    <div className="adm-bars">
      <ul>
        {visible.map((row) => (
          <li key={row.key} title={row.note}>
            <div className="adm-bar-text">
              <span className="adm-bar-label">{row.label}</span>
              <span className="adm-bar-value">{formatNumber(row.value)}</span>
            </div>
            <div className="adm-bar-track" aria-hidden="true">
              <div className="adm-bar-fill" style={{ width: `${Math.max(1.5, (row.value / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {rows.length > shown && (
        <button type="button" className="adm-link-btn" onClick={() => setAll(!all)}>
          {all ? t('common.showLess') : t('common.showAll', { n: rows.length })}
        </button>
      )}
    </div>
  );
}

/** Shares of a whole (at most three slices: past that it isn't readable), with the numbers beside it. */
export function Donut({ rows, centerLabel }: { rows: { key: string; label: string; value: number }[]; centerLabel: string }) {
  const { formatNumber } = useAdminI18n();
  const [hover, setHover] = useState<string | null>(null);
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const gap = rows.filter((row) => row.value > 0).length > 1 ? 3 : 0;
  let offset = 0;
  const focus = hover ? rows.find((row) => row.key === hover) : null;
  return (
    <div className="adm-donut">
      <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label={rows.map((row) => `${row.label}: ${row.value}`).join(', ')}>
        <circle className="adm-donut-track" cx="70" cy="70" r={r} />
        {total > 0 &&
          rows.map((row, i) => {
            const length = (row.value / total) * circumference;
            const dash = Math.max(0, length - gap);
            const el = (
              <circle
                key={row.key}
                className={`adm-donut-slice is-s${i + 1}${hover && hover !== row.key ? ' is-dim' : ''}`}
                cx="70"
                cy="70"
                r={r}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
                onPointerEnter={() => setHover(row.key)}
                onPointerLeave={() => setHover(null)}
              />
            );
            offset += length;
            return el;
          })}
        <text x="70" y="66" textAnchor="middle" className="adm-donut-value">
          {formatNumber(focus ? focus.value : total)}
        </text>
        <text x="70" y="84" textAnchor="middle" className="adm-donut-label">
          {focus ? focus.label : centerLabel}
        </text>
      </svg>
      <ul className="adm-donut-legend">
        {rows.map((row, i) => (
          <li key={row.key} onPointerEnter={() => setHover(row.key)} onPointerLeave={() => setHover(null)}>
            <i className={`adm-swatch is-s${i + 1}`} aria-hidden="true" />
            <span>{row.label}</span>
            <strong>{formatNumber(row.value)}</strong>
            <span className="adm-muted">{total ? Math.round((row.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
