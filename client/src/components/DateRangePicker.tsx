import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock } from 'lucide-react';
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
/** Every 5 minutes; a period's minutes also have :59 (its last day "until 23:59"). */
const FIVES = Array.from({ length: 12 }, (_, i) => i * 5);
const MINUTES = [...FIVES, 59];

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

/** A time wheel's row height (px): the same as --row in styles/components.css. */
const ROW = 40;
/** How long a wheel must be still to have stopped on a value (ms). */
const SETTLE = 140;

/**
 * One column of the time: its values on a wheel, three in view, the chosen one in the band in the middle. It turns by
 * swiping or scrolling (and settles on a value), with the arrows above and below it, by tapping a value, or with the
 * keyboard (up and down, Page Up/Down, Home and End).
 */
function TimeWheel({ label, values, value, onChange }: { label: string; values: number[]; value: number; onChange: (value: number) => void }) {
  const { t } = useI18n();
  const track = useRef<HTMLDivElement>(null);
  const settle = useRef(0);
  // A time off the list (one typed elsewhere, e.g. 18:13) starts on the value nearest to it.
  const [index, setIndex] = useState(() => values.reduce((best, v, i) => (Math.abs(v - value) < Math.abs(values[best] - value) ? i : best), 0));
  const lastIndex = values.length - 1;

  // It opens with the chosen value in the band.
  useLayoutEffect(() => {
    if (track.current) track.current.scrollTop = index * ROW;
  }, []);
  useEffect(() => () => window.clearTimeout(settle.current), []);

  const turnTo = (i: number) => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.current?.scrollTo({ top: Math.max(0, Math.min(lastIndex, i)) * ROW, behavior: still ? 'auto' : 'smooth' });
  };

  // While it turns, the value in the band is marked; once it stops there, that's the time.
  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const i = Math.max(0, Math.min(lastIndex, Math.round(el.scrollTop / ROW)));
    setIndex(i);
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => onChange(values[i]), SETTLE);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const to: Record<string, number> = { ArrowUp: index - 1, ArrowDown: index + 1, PageUp: index - 4, PageDown: index + 4, Home: 0, End: lastIndex };
    if (!(event.key in to)) return;
    event.preventDefault();
    turnTo(to[event.key]);
  };

  return (
    <div className="time-wheel">
      <button type="button" className="time-wheel-arrow" aria-label={t('date.earlier')} disabled={index === 0} onClick={() => turnTo(index - 1)}>
        <ChevronUp size={18} />
      </button>
      <div className="time-wheel-window">
        <div
          ref={track}
          className="time-wheel-track"
          role="spinbutton"
          tabIndex={0}
          aria-label={label}
          aria-valuenow={values[index]}
          aria-valuemin={values[0]}
          aria-valuemax={values[lastIndex]}
          aria-valuetext={pad(values[index])}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
        >
          {/* Room above the first value and below the last, so both can stand in the band. */}
          <span className="time-wheel-room" aria-hidden="true" />
          {values.map((v, i) => (
            <span key={v} className={`time-wheel-value${i === index ? ' is-selected' : ''}`} aria-hidden="true" onClick={() => turnTo(i)}>
              {pad(v)}
            </span>
          ))}
          <span className="time-wheel-room" aria-hidden="true" />
        </div>
      </div>
      <button type="button" className="time-wheel-arrow" aria-label={t('date.later')} disabled={index === lastIndex} onClick={() => turnTo(index + 1)}>
        <ChevronDown size={18} />
      </button>
    </div>
  );
}

/** A time: hours and minutes, each on a wheel. */
function TimeColumns({ time, onChange, minutes = MINUTES }: { time: Time; onChange: (time: Time) => void; minutes?: number[] }) {
  const { t } = useI18n();
  return (
    <div className="time-columns">
      <TimeWheel label={t('date.hour')} values={HOURS} value={time.h} onChange={(h) => onChange({ ...time, h })} />
      <span className="time-colon" aria-hidden="true">
        :
      </span>
      <TimeWheel label={t('date.minute')} values={minutes} value={time.m} onChange={(m) => onChange({ ...time, m })} />
    </div>
  );
}

/**
 * A period: a quick choice (today, the last 7 days…, applied at once; `anytime`, its name: no period), or a first and
 * a last day on the calendar, each with a time (from 00:00 to 23:59 unless changed), applied with "Apply" ("Cancel"
 * leaves it as it was). Days after today can't be picked.
 */
export function DateRangePicker({ value, onChange, onDone, anytime }: { value: DateRange; onChange: (range: DateRange) => void; onDone: () => void; anytime?: string }) {
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
  // The quick choice the chosen days are, if any (marked in the list).
  const chosen =
    start && end
      ? PRESETS.find((preset) => {
          const [first, lastDay] = preset.days(today);
          return sameDay(first, start) && sameDay(lastDay, end);
        })
      : undefined;

  // Wide screens: the quick choices in a column beside the calendar; narrower ones: above it (styles/components.css).
  return (
    <div className="date-range">
      <div className="date-presets" role="group" aria-label={t('date.quick')}>
        <span className="date-presets-title" aria-hidden="true">
          {t('date.quick')}
        </span>
        {anytime && (
          <button
            type="button"
            className={`date-preset${!value.from && !value.to ? ' is-selected' : ''}`}
            aria-pressed={!value.from && !value.to}
            onClick={() => done({ from: null, to: null })}
          >
            {anytime}
            {!value.from && !value.to && <Check size={15} aria-hidden="true" />}
          </button>
        )}
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={`date-preset${preset === chosen ? ' is-selected' : ''}`}
            aria-pressed={preset === chosen}
            onClick={() => {
              const [first, lastDay] = preset.days(today);
              done({ from: at(first, DAY_START), to: at(lastDay, DAY_END, true) });
            }}
          >
            {t(preset.label)}
            {preset === chosen && <Check size={15} aria-hidden="true" />}
          </button>
        ))}
      </div>

      <div className="date-main">
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          {t('common.cancel')}
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
    </div>
  );
}

/** Quick choices of a moment to come: their day and time. */
const MOMENTS: { label: MessageKey; at: (today: Date) => Date }[] = [
  { label: 'date.tomorrowAt9', at: (today) => at(addDays(today, 1), { h: 9, m: 0 }) },
  { label: 'date.tomorrowAt19', at: (today) => at(addDays(today, 1), { h: 19, m: 0 }) },
];

/**
 * A moment to come (a post's scheduled publishing): a quick choice (tomorrow at 09:00 or 19:00, applied at once), or
 * a day on the calendar with its time (09:00 unless changed), applied with "Apply" ("Cancel" leaves it as it was).
 * Days before today can't be picked, nor a time that has passed. With `onSeeScheduled`, last among the quick choices:
 * what's scheduled already (shown by whoever opened this). The same look as DateRangePicker.
 */
export function DateTimePicker({ value, onChange, onDone, onSeeScheduled }: { value: Date | null; onChange: (moment: Date) => void; onDone: () => void; onSeeScheduled?: () => void }) {
  const { t, locale } = useI18n();
  const today = startOfDay(new Date());
  const [day, setDay] = useState<Date | null>(value && startOfDay(value));
  const [time, setTime] = useState<Time>(value ? { h: value.getHours(), m: value.getMinutes() } : { h: 9, m: 0 });
  const [month, setMonth] = useState(() => addMonths(value ?? today, 0));
  const [timeOpen, setTimeOpen] = useState(false);

  const done = (moment: Date) => {
    onChange(moment);
    onDone();
  };
  const moment = day ? at(day, time) : null;
  const passed = moment !== null && moment <= new Date();
  const chosen = value ? MOMENTS.find((entry) => entry.at(today).getTime() === value.getTime()) : undefined;

  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i)));
  const dayName = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="date-range is-moment">
      <div className="date-presets" role="group" aria-label={t('date.quick')}>
        <span className="date-presets-title" aria-hidden="true">
          {t('date.quick')}
        </span>
        {MOMENTS.map((entry) => (
          <button
            key={entry.label}
            type="button"
            className={`date-preset${entry === chosen ? ' is-selected' : ''}`}
            aria-pressed={entry === chosen}
            onClick={() => done(entry.at(today))}
          >
            {t(entry.label)}
            {entry === chosen && <Check size={15} aria-hidden="true" />}
          </button>
        ))}
        {onSeeScheduled && (
          <button type="button" className="date-preset is-link" onClick={onSeeScheduled}>
            <CalendarClock size={15} aria-hidden="true" />
            {t('schedule.see')}
          </button>
        )}
      </div>

      <div className="date-main">
        <div className="date-month">
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label={t('date.prevMonth')}
            disabled={month <= addMonths(today, 0)}
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <strong>{new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month)}</strong>
          <button type="button" className="icon-btn icon-btn-sm" aria-label={t('date.nextMonth')} onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="date-grid">
          {weekdays.map((name, i) => (
            <span key={i} className="date-weekday" aria-hidden="true">
              {name}
            </span>
          ))}
          {monthDays(month).map((d) => {
            const picked = sameDay(d, day);
            const classes = ['date-day', d.getMonth() !== month.getMonth() && 'is-outside', sameDay(d, today) && 'is-today', picked && 'is-edge'];
            return (
              <button
                key={d.getTime()}
                type="button"
                className={classes.filter(Boolean).join(' ')}
                disabled={d < today}
                aria-label={dayName.format(d)}
                aria-pressed={picked}
                onClick={() => setDay(d)}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>

        <p className={`date-hint small${passed ? ' is-warning' : ' muted'}`} aria-live="polite">
          {!day ? t('date.pickDay') : passed ? t('date.timePassed') : `${dayName.format(day)}, ${pad(time.h)}:${pad(time.m)}`}
        </p>

        <div className="date-times is-single">
          <button type="button" className={`date-time${timeOpen ? ' is-open' : ''}`} aria-expanded={timeOpen} onClick={() => setTimeOpen(!timeOpen)}>
            <span className="date-time-label">{t('date.hour')}</span>
            <span className="date-time-value">
              <Clock size={14} aria-hidden="true" /> {pad(time.h)}:{pad(time.m)}
            </span>
          </button>
        </div>
        {timeOpen && <TimeColumns time={time} onChange={setTime} minutes={FIVES} />}

        <div className="date-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!moment || passed} onClick={() => moment && done(moment)}>
            {t('date.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
