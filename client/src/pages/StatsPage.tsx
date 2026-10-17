import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import {
  Bell,
  Bookmark,
  BookOpenCheck,
  Check,
  ChevronDown,
  Clock,
  Eye,
  Heart,
  MessageCircle,
  MessageCircleX,
  PenLine,
  Share2,
  SmilePlus,
  Timer,
  UserPlus,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { MenuButton } from '@/components/MenuButton';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

type Days = 7 | 30 | 90;
/** Posts listed before "Show all". */
const POSTS_SHOWN = 10;
/** Breakdown rows listed before "Show all". */
const ROWS_SHOWN = 6;

interface Totals {
  pageViews: number;
  postViews: number;
  visitors: number;
  avgSeconds: number;
  readThrough: number;
  likes: number;
  comments: number;
  replies: number;
  shares: number;
  saves: number;
  secondsToLike: number | null;
  secondsToComment: number | null;
}

interface Stats {
  days: Days;
  from: string;
  to: string;
  /** An author's own posts only (no other pages, no community). */
  mine: boolean;
  /** Whose posts these are, when narrowed to one author (an author's own, or an administrator's pick). */
  author: { id: number; name: string } | null;
  /** Administrators: everyone who has written a post, to narrow the statistics to. */
  authors: { id: number; name: string; posts: number }[] | null;
  totals: Totals;
  /** The period before, as long: what the totals are compared with. */
  previous: Totals;
  daily: { day: string; views: number; visitors: number }[];
  posts: {
    id: number;
    title: string;
    slug: string;
    views: number;
    visitors: number;
    avgSeconds: number;
    readThrough: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
  }[];
  actions: { action: string; times: number; visitors: number }[];
  referrers: { host: string | null; views: number }[];
  devices: { device: string; views: number }[];
  pages: { path: string; views: number; visitors: number }[];
  /** Administrators, the whole site only. */
  community: {
    accounts: number;
    writers: number;
    newAccounts: number;
    pushReaders: number;
    pushWriters: number;
    reactions: number;
    likesTakenBack: number;
    commentsDeleted: number;
    commentEdits: number;
  } | null;
}

/** "42 s", "3 min 05 s", "1 h 02 min". */
function duration(seconds: number | null) {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
  return `${Math.floor(seconds / 3600)} h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')} min`;
}

/** The element's width, kept up to date: charts are drawn at their real size (sharp lines and text). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** How a number moved since the period before: "▲ 12%", "▼ 3 p.p." (for percentages), "nou" (up from nothing). */
function Change({ now, before, points = false }: { now: number; before: number; points?: boolean }) {
  const { t, formatNumber } = useI18n();
  if (now === 0 && before === 0) return null;
  const title = t('stats.vsPrevious', { value: points ? `${before}%` : formatNumber(before) });
  if (before === 0 && !points) {
    return (
      <span className="stats-change is-up" title={title}>
        {t('stats.new')}
      </span>
    );
  }
  const diff = points ? now - before : Math.round(((now - before) / before) * 100);
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  return (
    <span className={`stats-change is-${direction}`} title={title}>
      {direction === 'up' ? '▲' : direction === 'down' ? '▼' : '='} {formatNumber(Math.abs(diff))}
      {points ? ' p.p.' : '%'}
    </span>
  );
}

/** A small line under a tile's number: the period's days. */
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const width = 100;
  const height = 30;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, i) => `${(i * step).toFixed(2)},${(height - 1 - (value / max) * (height - 4)).toFixed(2)}`).join(' ');
  return (
    <svg className="stats-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,${height} ${points} ${width},${height}`} className="stats-spark-area" />
      <polyline points={points} className="stats-spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** One of the four main numbers: its name, the number and how it changed, a note, and (views, visitors) its days. */
function Kpi(props: { icon: LucideIcon; label: string; value: string; change: ReactNode; note?: string; spark?: number[] }) {
  const { icon: Icon, label, value, change, note, spark } = props;
  return (
    <div className="card stats-kpi">
      <span className="stats-kpi-label">
        <Icon size={15} aria-hidden="true" /> {label}
      </span>
      <span className="stats-kpi-row">
        <strong className="stats-kpi-value">{value}</strong>
        {change}
      </span>
      {note && <span className="stats-kpi-note">{note}</span>}
      {spark && <Sparkline values={spark} />}
    </div>
  );
}

/** The chart's scale: about five even steps of 1, 2 or 5 (times 10, 100...), up to the busiest day (at least 4). */
function scale(max: number) {
  const highest = Math.max(max, 4);
  const raw = highest / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const step = Math.max(1, (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power);
  const top = Math.ceil(highest / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

/** Views (an area) and visitors (a line) per day, with a scale; pointing at a day (or touching it) shows its numbers. */
function TrafficChart({ daily }: { daily: Stats['daily'] }) {
  const { t, plural, formatDate, formatShortDate, formatNumber } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gradient = `traffic-${useId().replace(/[^\w-]/g, '')}`;
  const narrow = width < 560;
  const height = narrow ? 210 : 260;
  const pad = { top: 14, right: 10, bottom: 28, left: 36 };
  const innerWidth = Math.max(1, width - pad.left - pad.right);
  const innerHeight = height - pad.top - pad.bottom;
  const { top, ticks } = scale(Math.max(0, ...daily.map((d) => Math.max(d.views, d.visitors))));
  const x = (i: number) => pad.left + (daily.length <= 1 ? innerWidth / 2 : (i / (daily.length - 1)) * innerWidth);
  const y = (value: number) => pad.top + innerHeight - (value / top) * innerHeight;
  const line = (key: 'views' | 'visitors') => daily.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const area = `${line('views')} L${x(daily.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  // A few dates along the bottom, spread out (the first and last at the ends).
  const labels = Math.min(daily.length, narrow ? 3 : 6);
  const labelAt = Array.from({ length: labels }, (_, k) => Math.round((k * (daily.length - 1)) / Math.max(1, labels - 1)));
  const views = daily.reduce((sum, d) => sum + d.views, 0);

  const pick = (clientX: number) => {
    const box = ref.current!.getBoundingClientRect();
    const i = Math.round(((clientX - box.left - pad.left) / innerWidth) * (daily.length - 1));
    setHover(Math.max(0, Math.min(daily.length - 1, i)));
  };
  const point = hover === null ? null : daily[hover]!;
  const tooltipWidth = 168;

  return (
    <div
      ref={ref}
      className="stats-traffic"
      onPointerMove={(event) => pick(event.clientX)}
      onPointerDown={(event) => pick(event.clientX)}
      onPointerLeave={() => setHover(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={t('stats.trafficLabel', { views: formatNumber(views), days: daily.length })}>
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopOpacity="0.32" />
              <stop offset="100%" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((value) => (
            <g key={value}>
              <line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} className="stats-grid-line" />
              <text x={pad.left - 8} y={y(value)} className="stats-axis" textAnchor="end" dominantBaseline="middle">
                {formatNumber(value)}
              </text>
            </g>
          ))}
          {labelAt.map((i) => (
            <text key={i} x={x(i)} y={height - 8} className="stats-axis" textAnchor={i === 0 ? 'start' : i === daily.length - 1 ? 'end' : 'middle'}>
              {formatShortDate(daily[i]!.day)}
            </text>
          ))}
          <path d={area} fill={`url(#${gradient})`} />
          <path d={line('views')} className="stats-line-views" />
          <path d={line('visitors')} className="stats-line-visitors" />
          {point && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerHeight} className="stats-cursor" />
              <circle cx={x(hover)} cy={y(point.views)} r="4.5" className="stats-dot-views" />
              <circle cx={x(hover)} cy={y(point.visitors)} r="4" className="stats-dot-visitors" />
            </g>
          )}
        </svg>
      )}
      {point && hover !== null && (
        <div className="stats-tooltip" style={{ left: Math.min(Math.max(x(hover) - tooltipWidth / 2, 0), width - tooltipWidth), width: tooltipWidth }}>
          <strong>{formatDate(point.day)}</strong>
          <span>
            <i className="stats-key is-views" aria-hidden="true" /> {plural('post.views', point.views)}
          </span>
          <span>
            <i className="stats-key is-visitors" aria-hidden="true" /> {plural('stats.visitorsN', point.visitors)}
          </span>
        </div>
      )}
    </div>
  );
}

/** How the views split by device: a ring, and the shares beside it. */
function Donut({ rows }: { rows: { key: string; label: string; value: number }[] }) {
  const { t, formatNumber } = useI18n();
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  if (total === 0) return <p className="muted small">{t('stats.empty')}</p>;
  return (
    <div className="stats-donut">
      <svg viewBox="0 0 120 120" width="132" height="132" role="img" aria-label={rows.map((row) => `${row.label}: ${Math.round((row.value / total) * 100)}%`).join(', ')}>
        <circle cx="60" cy="60" r={radius} className="stats-donut-track" />
        {rows.map((row, i) => {
          const length = (row.value / total) * circumference;
          const part = (
            <circle
              key={row.key}
              cx="60"
              cy="60"
              r={radius}
              className={`stats-donut-part is-${i % 4}`}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          );
          offset += length;
          return part;
        })}
        <text x="60" y="58" textAnchor="middle" className="stats-donut-total">
          {formatNumber(total)}
        </text>
        <text x="60" y="76" textAnchor="middle" className="stats-donut-caption">
          {t('stats.viewsShort')}
        </text>
      </svg>
      <ul className="stats-donut-legend">
        {rows.map((row, i) => (
          <li key={row.key}>
            <span className={`stats-swatch is-${i % 4}`} aria-hidden="true" />
            <span className="stats-donut-name">{row.label}</span>
            <strong>{Math.round((row.value / total) * 100)}%</strong>
            <span className="muted small">{formatNumber(row.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A breakdown (what readers do, where they come from, the other pages): bars, the largest full. */
function Bars({ title, rows }: { title: string; rows: { key: string; label: string; value: number; note?: string }[] }) {
  const { t, formatNumber } = useI18n();
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...rows.map((row) => row.value));
  const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
  return (
    <section className="card stats-card">
      <h2 className="side-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="muted small">{t('stats.empty')}</p>
      ) : (
        <>
          <ul className="stats-bars">
            {shown.map((row) => (
              <li key={row.key}>
                <span className="stats-bar-label">{row.label}</span>
                <span className="stats-bar-value">
                  {formatNumber(row.value)}
                  {row.note && <small> · {row.note}</small>}
                </span>
                <span className="stats-bar-track" aria-hidden="true">
                  <span style={{ width: `${(row.value / max) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
          {!all && rows.length > ROWS_SHOWN && (
            <button type="button" className="btn btn-ghost btn-sm stats-more" onClick={() => setAll(true)}>
              {t('stats.showAll', { n: rows.length })}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** The posts, most viewed first: a bar for the views, then what readers did (a row on wide screens, a line on phones). */
function PostsList({ posts }: { posts: Stats['posts'] }) {
  const { t, formatNumber: n } = useI18n();
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...posts.map((post) => post.views));
  const shown = all ? posts : posts.slice(0, POSTS_SHOWN);
  const num = (icon: LucideIcon, label: string, value: string, main = false) => {
    const Icon = icon;
    return (
      <span className={`stats-post-num${main ? ' is-main' : ''}`} title={label}>
        <Icon size={13} aria-hidden="true" />
        <span className="visually-hidden">{label}: </span>
        {value}
      </span>
    );
  };
  return (
    <>
      <div className="stats-posts-head" aria-hidden="true">
        <span />
        <span>{t('stats.post')}</span>
        <span>{t('stats.views')}</span>
        <span>{t('stats.visitors')}</span>
        <span>{t('stats.colTime')}</span>
        <span>{t('stats.colEnd')}</span>
        <span>
          <Heart size={14} />
        </span>
        <span>
          <MessageCircle size={14} />
        </span>
        <span>
          <Share2 size={14} />
        </span>
      </div>
      <ol className="stats-posts">
        {shown.map((post, index) => (
          <li key={post.id} className="stats-post">
            <span className="stats-post-rank">{index + 1}</span>
            <span className="stats-post-main">
              <Link to={`/posts/${post.slug}`} className="stats-post-title">
                {post.title}
              </Link>
              <span className="stats-post-bar" aria-hidden="true">
                <span style={{ width: `${(post.views / max) * 100}%` }} />
              </span>
            </span>
            <span className="stats-post-nums">
              {num(Eye, t('stats.views'), n(post.views), true)}
              {num(Users, t('stats.visitors'), n(post.visitors))}
              {num(Clock, t('stats.colTime'), duration(post.avgSeconds))}
              {num(BookOpenCheck, t('stats.colEnd'), `${post.readThrough}%`)}
              {num(Heart, t('stats.likes'), n(post.likes))}
              {num(MessageCircle, t('stats.comments'), n(post.comments))}
              {num(Share2, t('stats.shares'), n(post.shares))}
            </span>
          </li>
        ))}
      </ol>
      {!all && posts.length > POSTS_SHOWN && (
        <button type="button" className="btn btn-ghost btn-sm stats-more" onClick={() => setAll(true)}>
          {t('stats.showAll', { n: posts.length })}
        </button>
      )}
    </>
  );
}

/**
 * The statistics, for a period of 7, 30 or 90 days compared with the one before it: the four main numbers, views and
 * visitors by day, what readers do (likes, comments, shares, saves), the posts, what they click, where they come from,
 * on what. `admin`: the whole site's (administrators), which can be narrowed to one author (?author=, kept in the
 * address), with the site's other pages and its community; otherwise an author's own posts.
 */
function StatsView({ admin }: { admin: boolean }) {
  const { t, plural, formatDate, formatNumber: n } = useI18n();
  const [params, setParams] = useSearchParams();
  const [days, setDays] = useState<Days>(30);
  const [stats, setStats] = useState<Stats | null>(null);
  /** The request the statistics on screen answer; while another is on its way, they're dimmed. */
  const [shown, setShown] = useState('');
  const [error, setError] = useState(false);
  const authorId = admin ? Number(params.get('author')) || null : null;
  const request = `/stats?days=${days}${authorId ? `&author=${authorId}` : ''}`;

  useEffect(() => {
    let cancelled = false;
    setError(false);
    api<Stats>(request)
      .then((data) => {
        if (cancelled) return;
        setStats(data);
        setShown(request);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [request]);

  const pickAuthor = (id: number | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set('author', String(id));
        else next.delete('author');
        return next;
      },
      { replace: true },
    );

  const label = (key: string) => t(`stats.action.${key}` as MessageKey);
  const totals = stats?.totals;
  const previous = stats?.previous;
  const authorName = stats?.authors?.find((author) => author.id === authorId)?.name;

  return (
    <div className="container stats-page">
      {admin ? <HeaderBackLink to="/admin" label={t('admin.back')} /> : <HeaderBackLink />}
      <div className="stats-head">
        <div className="stats-head-text">
          <h1>{t(admin ? 'stats.adminTitle' : 'stats.mine')}</h1>
          {stats && (
            <p className="muted">
              {formatDate(stats.from)} – {formatDate(stats.to)} · {plural('stats.comparedWith', stats.days)}
              {stats.mine ? ` · ${t('stats.mineNote')}` : stats.author && ` · ${t('stats.authorNote', { name: stats.author.name })}`}
            </p>
          )}
        </div>
        <div className="stats-controls">
          {admin && stats?.authors && stats.authors.length > 0 && (
            <MenuButton
              title={t('stats.author')}
              buttonClassName={`filter-field stats-author${authorId ? ' has-value' : ''}`}
              panelClassName="filter-popover"
              button={
                <>
                  <span className="filter-field-text">
                    <span className="filter-field-label">{t('stats.author')}</span>
                    <span className="filter-field-value">{authorName ?? t('stats.allAuthors')}</span>
                  </span>
                  <ChevronDown size={16} aria-hidden="true" />
                </>
              }
            >
              {(close) => (
                <div className="filter-options" role="listbox" aria-label={t('stats.author')}>
                  {[{ id: null, name: t('stats.allAuthors'), posts: null }, ...stats.authors!].map((author) => (
                    <button
                      key={author.id ?? 'all'}
                      type="button"
                      role="option"
                      aria-selected={author.id === authorId}
                      className={`filter-option${author.id === authorId ? ' is-selected' : ''}`}
                      onClick={() => {
                        pickAuthor(author.id);
                        close();
                      }}
                    >
                      {author.name}
                      {author.posts !== null && <span className="muted small">{t('stats.postsCount', { n: author.posts })}</span>}
                      {author.id === authorId && <Check size={16} className="filter-option-check" />}
                    </button>
                  ))}
                </div>
              )}
            </MenuButton>
          )}
          <div className="segmented stats-period" role="group" aria-label={t('stats.period')}>
            {([7, 30, 90] as const).map((option) => (
              <button key={option} type="button" className={days === option ? 'is-selected' : ''} aria-pressed={days === option} onClick={() => setDays(option)}>
                {t('stats.days', { n: option })}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="form-error">{t('error.generic')}</p>}
      {!stats || !totals || !previous ? (
        !error && <p className="muted">{t('common.loading')}</p>
      ) : (
        <div className={`stats-body${shown === request ? '' : ' is-loading'}`}>
          <div className="stats-kpis">
            <Kpi
              icon={Eye}
              label={t('stats.views')}
              value={n(totals.pageViews)}
              change={<Change now={totals.pageViews} before={previous.pageViews} />}
              note={stats.author ? undefined : t('stats.postViews', { n: n(totals.postViews) })}
              spark={stats.daily.map((d) => d.views)}
            />
            <Kpi
              icon={Users}
              label={t('stats.visitors')}
              value={n(totals.visitors)}
              change={<Change now={totals.visitors} before={previous.visitors} />}
              spark={stats.daily.map((d) => d.visitors)}
            />
            <Kpi icon={Clock} label={t('stats.avgTime')} value={duration(totals.avgSeconds)} change={<Change now={totals.avgSeconds} before={previous.avgSeconds} />} />
            <Kpi
              icon={BookOpenCheck}
              label={t('stats.readThrough')}
              value={`${totals.readThrough}%`}
              change={<Change now={totals.readThrough} before={previous.readThrough} points />}
            />
          </div>

          <div className="stats-main">
            <section className="card stats-card stats-traffic-card">
              <div className="stats-card-head">
                <h2 className="side-title">{t('stats.traffic')}</h2>
                <span className="stats-keys">
                  <span>
                    <i className="stats-key is-views" aria-hidden="true" /> {t('stats.legendViews')}
                  </span>
                  <span>
                    <i className="stats-key is-visitors" aria-hidden="true" /> {t('stats.legendVisitors')}
                  </span>
                </span>
              </div>
              <TrafficChart daily={stats.daily} />
            </section>

            <section className="card stats-card stats-engage">
              <h2 className="side-title">{t('stats.interactions')}</h2>
              <ul className="stats-engage-list">
                {(
                  [
                    [Heart, t('stats.likes'), totals.likes, previous.likes, null],
                    [MessageCircle, t('stats.comments'), totals.comments, previous.comments, t('stats.replies', { n: n(totals.replies) })],
                    [Share2, t('stats.shares'), totals.shares, previous.shares, null],
                    [Bookmark, t('stats.saves'), totals.saves, previous.saves, null],
                  ] as const
                ).map(([Icon, name, value, before, note]) => (
                  <li key={name}>
                    <span className="stats-engage-icon">
                      <Icon size={17} aria-hidden="true" />
                    </span>
                    <span className="stats-engage-name">
                      {name}
                      {note && <small>{note}</small>}
                    </span>
                    <strong>{n(value)}</strong>
                    <Change now={value} before={before} />
                  </li>
                ))}
              </ul>
              <div className="stats-engage-times">
                <span>
                  <Timer size={15} aria-hidden="true" /> {t('stats.toLike')}
                  <strong>{duration(totals.secondsToLike)}</strong>
                </span>
                <span>
                  <Timer size={15} aria-hidden="true" /> {t('stats.toComment')}
                  <strong>{duration(totals.secondsToComment)}</strong>
                </span>
              </div>
            </section>
          </div>

          <section className="card stats-card">
            <h2 className="side-title">{t('stats.posts')}</h2>
            {stats.posts.length === 0 ? <p className="muted small">{t('stats.empty')}</p> : <PostsList posts={stats.posts} />}
          </section>

          <div className="stats-grid">
            <Bars
              title={t('stats.actions')}
              rows={stats.actions.map((a) => ({ key: a.action, label: label(a.action), value: a.times, note: t('stats.people', { n: n(a.visitors) }) }))}
            />
            <Bars title={t('stats.referrers')} rows={stats.referrers.map((r) => ({ key: r.host ?? '-', label: r.host ?? t('stats.direct'), value: r.views }))} />
            <section className="card stats-card">
              <h2 className="side-title">{t('stats.devices')}</h2>
              <Donut rows={stats.devices.map((d) => ({ key: d.device, label: t(`stats.device.${d.device}` as MessageKey), value: d.views }))} />
            </section>
          </div>

          {/* The whole site's statistics (administrators): its other pages and its community. */}
          {!stats.author && stats.pages.length > 0 && (
            <Bars title={t('stats.pages')} rows={stats.pages.map((p) => ({ key: p.path, label: p.path, value: p.views, note: t('stats.people', { n: n(p.visitors) }) }))} />
          )}
          {stats.community && (
            <section className="stats-community">
              <h2 className="side-title">{t('admin.community')}</h2>
              <div className="stats-tiles">
                {(
                  [
                    [Users, t('admin.accounts'), stats.community.accounts, t('admin.writers', { n: n(stats.community.writers) })],
                    [UserPlus, t('admin.newAccounts'), stats.community.newAccounts, null],
                    [Bell, t('admin.pushReaders'), stats.community.pushReaders, t('admin.pushWriters', { n: n(stats.community.pushWriters) })],
                    [SmilePlus, t('admin.reactions'), stats.community.reactions, null],
                    [Heart, t('admin.likesTakenBack'), stats.community.likesTakenBack, null],
                    [PenLine, t('admin.commentEdits'), stats.community.commentEdits, null],
                    [MessageCircleX, t('admin.commentsDeleted'), stats.community.commentsDeleted, null],
                  ] as const
                ).map(([Icon, name, value, note]) => (
                  <div key={name} className="stats-tile card">
                    <span className="stats-tile-label">
                      <Icon size={15} aria-hidden="true" /> {name}
                    </span>
                    <strong className="stats-tile-value">{n(value)}</strong>
                    {note && <span className="stats-tile-note">{note}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}
          <p className="muted small stats-note">{t('stats.note')}</p>
        </div>
      )}
    </div>
  );
}

/** /statistici: an author's own statistics. Administrators have the whole site's, in the administration. */
export function StatsPage() {
  const { isOwner } = useAuth();
  return isOwner ? <Navigate to="/admin/statistici" replace /> : <StatsView admin={false} />;
}

/** /admin/statistici: the whole site's statistics (administrators). */
export function AdminStatsPage() {
  return <StatsView admin />;
}
