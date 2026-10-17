import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

interface Time {
  h: number;
  m: number;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const sameDay = (a: Date | null, b: Date | null) => a !== null && b !== null && a.toDateString() === b.toDateString();
/** The day at that time; `end`: the minute's last moment, so "until 18:30" includes what happened at 18:30. */
const at = (day: Date, time: Time, end = false) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.h, time.m, end ? 59 : 0, end ? 999 : 0);
const pad = (n: number) => String(n).padStart(2, '0');

const DAY_START: Time = { h: 0, m: 0 };
const DAY_END: Time = { h: 23, m: 59 };
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [...Array.from({ length: 12 }, (_, i) => i * 5), 59];

/** The six weeks a month is shown in, Monday first. */
function monthDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Quick choices: their first and last day. */
const PRESETS: { label: MessageKey; days: (today: Date) => [Date, Date] }[] = [
  { label: 'date.today', days: (today) => [today, today] },
  { label: 'date.yesterday', days: (today) => [addDays(today, -1), addDays(today, -1)] },
  { label: 'date.last7', days: (today) => [addDays(today, -6), today] },
  { label: 'date.last30', days: (today) => [addDays(today, -29), today] },
  { label: 'date.thisMonth', days: (today) => [new Date(today.getFullYear(), today.getMonth(), 1), today] },
  { label: 'date.lastMonth', days: (today) => [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)] },
];

/** Hours and minutes in two columns that scroll, the chosen ones highlighted (and in view when it opens). */
function TimeColumns({ time, onChange }: { time: Time; onChange: (time: Time) => void }) {
  const { t } = useI18n();
  const hours = useRef<HTMLDivElement>(null);
  const minutes = useRef<HTMLDivElement>(null);

  useEffect(() => {
    for (const list of [hours.current, minutes.current]) {
      const chosen = list?.querySelector<HTMLElement>('.is-selected');
      if (list && chosen) list.scrollTop = chosen.offsetTop - (list.clientHeight - chosen.offsetHeight) / 2;
    }
  }, []);

  const column = (ref: typeof hours, label: MessageKey, values: number[], current: number, pick: (value: number) => void) => (
    <div ref={ref} className="time-column" role="listbox" aria-label={t(label)}>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          role="option"
          aria-selected={value === current}
          className={value === current ? 'is-selected' : ''}
          onClick={() => pick(value)}
        >
          {pad(value)}
        </button>
      ))}
    </div>
  );

  return (
    <div className="time-columns">
      {column(hours, 'date.hour', HOURS, time.h, (h) => onChange({ ...time, h }))}
      <span className="time-colon" aria-hidden="true">
        :
      </span>
      {column(minutes, 'date.minute', MINUTES, time.m, (m) => onChange({ ...time, m }))}
    </div>
  );
}

/**
 * A period: a quick choice (today, the last 7 days…, applied at once), or a first and a last day on the calendar,
 * each with a time (from 00:00 to 23:59 unless changed), applied with "Aplică". Days after today can't be picked.
 */
export function DateRangePicker({ value, onChange, onDone }: { value: DateRange; onChange: (range: DateRange) => void; onDone: () => void }) {
  const { t, locale } = useI18n();
  const today = startOfDay(new Date());
  const [start, setStart] = useState<Date | null>(value.from && startOfDay(value.from));
  const [end, setEnd] = useState<Date | null>(value.to && startOfDay(value.to));
  const [fromTime, setFromTime] = useState<Time>(value.from ? { h: value.from.getHours(), m: value.from.getMinutes() } : DAY_START);
  const [toTime, setToTime] = useState<Time>(value.to ? { h: value.to.getHours(), m: value.to.getMinutes() } : DAY_END);
  const [month, setMonth] = useState(() => addMonths(value.to ?? value.from ?? today, 0));
  const [hover, setHover] = useState<Date | null>(null);
  const [timeOpen, setTimeOpen] = useState<'from' | 'to' | null>(null);

  // A first click starts a period, a second ends it (or starts it, if it's earlier).
  const pick = (day: Date) => {
    if (!start || end) {
      setStart(day);
      setEnd(null);
    } else if (day < start) {
      setEnd(start);
      setStart(day);
    } else {
      setEnd(day);
    }
  };

  const done = (range: DateRange) => {
    onChange(range);
    onDone();
  };

  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i)));
  const dayName = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const shortDay = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  // While choosing the last day, the period follows the pointer.
  const last = end ?? (start && hover && hover > start ? hover : null);

  return (
    <div className="date-range">
      <div className="date-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="date-preset"
            onClick={() => {
              const [first, lastDay] = preset.days(today);
              done({ from: at(first, DAY_START), to: at(lastDay, DAY_END, true) });
            }}
          >
            {t(preset.label)}
          </button>
        ))}
      </div>

      <div className="date-month">
        <button type="button" className="icon-btn icon-btn-sm" aria-label={t('date.prevMonth')} onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={18} />
        </button>
        <strong>{new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month)}</strong>
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          aria-label={t('date.nextMonth')}
          disabled={month >= addMonths(today, 0)}
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="date-grid" onMouseLeave={() => setHover(null)}>
        {weekdays.map((name, i) => (
          <span key={i} className="date-weekday" aria-hidden="true">
            {name}
          </span>
        ))}
        {monthDays(month).map((day) => {
          const isStart = sameDay(day, start);
          const isLast = sameDay(day, last);
          const classes = [
            'date-day',
            day.getMonth() !== month.getMonth() && 'is-outside',
            sameDay(day, today) && 'is-today',
            (isStart || isLast) && 'is-edge',
            isStart && last && !isLast && 'is-start',
            isLast && start && !isStart && 'is-end',
            start && last && day > start && day < last && 'is-between',
          ];
          return (
            <button
              key={day.getTime()}
              type="button"
              className={classes.filter(Boolean).join(' ')}
              disabled={day > today}
              aria-label={dayName.format(day)}
              aria-pressed={isStart || sameDay(day, end)}
              onClick={() => pick(day)}
              onMouseEnter={() => setHover(day)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      <p className="date-hint muted small" aria-live="polite">
        {!start
          ? t('date.pickStart')
          : !end
            ? t('date.pickEnd', { day: shortDay.format(start) })
            : sameDay(start, end)
              ? dayName.format(start)
              : `${shortDay.format(start)} – ${shortDay.format(end)}`}
      </p>

      <div className="date-times">
        {(['from', 'to'] as const).map((which) => {
          const time = which === 'from' ? fromTime : toTime;
          return (
            <button
              key={which}
              type="button"
              className={`date-time${timeOpen === which ? ' is-open' : ''}`}
              aria-expanded={timeOpen === which}
              onClick={() => setTimeOpen(timeOpen === which ? null : which)}
            >
              <span className="date-time-label">{t(which === 'from' ? 'date.from' : 'date.to')}</span>
              <span className="date-time-value">
                <Clock size={14} aria-hidden="true" /> {pad(time.h)}:{pad(time.m)}
              </span>
            </button>
          );
        })}
      </div>
      {timeOpen && (
        <TimeColumns key={timeOpen} time={timeOpen === 'from' ? fromTime : toTime} onChange={timeOpen === 'from' ? setFromTime : setToTime} />
      )}

      <div className="date-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => done({ from: null, to: null })}>
          {t('date.clear')}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!start}
          onClick={() => start && done({ from: at(start, fromTime), to: at(end ?? start, toTime, true) })}
        >
          {t('date.apply')}
        </button>
      </div>
    </div>
  );
}
