import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BookOpenCheck, Clock, Eye, Users } from 'lucide-react';
import { BarList, Donut, TrafficChart } from '@/admin/charts';
import { useAdminI18n } from '@/admin/i18n';
import type { Stats } from '@/admin/types';
import { UserSelect } from '@/admin/UserSelect';
import { Card, Delta, ErrorNote, Kpi, Loading, PageHead, Select } from '@/admin/ui';
import { api } from '@/lib/api';
import type { MessageKey } from '@/lib/i18n/messages';

type Days = 7 | 30 | 90;
type SortKey = 'views' | 'visitors' | 'avgSeconds' | 'readThrough' | 'likes' | 'comments' | 'shares' | 'saves';

/** "42 s", "3 min 05 s", "1 h 02 min". */
export function duration(seconds: number | null) {
  if (seconds === null) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
}

interface SearchInsights {
  top: { query: string; searches: number; noResults: number }[];
  empty: { query: string; noResults: number }[];
  totals: { searches: number; noResults: number };
}

/**
 * What readers look for in the home page's search, and what they don't find (ideas for posts, or words to use in
 * them). Counted per day, with nothing about who searched.
 */
function SearchInsightsCards({ days }: { days: Days }) {
  const { t, formatNumber } = useAdminI18n();
  const [data, setData] = useState<SearchInsights | null>(null);

  useEffect(() => {
    api<SearchInsights>(`/admin/search-insights?days=${days}`)
      .then(setData)
      .catch(() => setData(null));
  }, [days]);

  if (!data) return null;
  const share = data.totals.searches ? Math.round((data.totals.noResults / data.totals.searches) * 100) : 0;
  return (
    <div className="adm-grid is-2">
      <Card title={t('search.top')} actions={<span className="adm-muted adm-small">{t('search.total', { n: formatNumber(data.totals.searches) })}</span>}>
        <BarList
          empty={t('search.none')}
          rows={data.top.map((row) => ({ key: row.query, label: row.query, value: row.searches, note: row.noResults ? t('search.noResultsN', { n: row.noResults }) : undefined }))}
        />
      </Card>
      <Card title={t('search.empty')} actions={data.totals.searches > 0 ? <span className="adm-muted adm-small">{t('search.emptyShare', { n: share })}</span> : undefined}>
        <BarList empty={t('search.noneEmpty')} rows={data.empty.map((row) => ({ key: row.query, label: row.query, value: row.noResults }))} />
        {data.empty.length > 0 && <p className="adm-muted adm-small">{t('search.emptyHint')}</p>}
      </Card>
    </div>
  );
}

/** The whole site's statistics, or one author's posts (?author=), for 7, 30 or 90 days, against the days before. */
export function StatsPage() {
  const { t, tb, formatNumber } = useAdminI18n();
  const [params, setParams] = useSearchParams();
  const days = (Number(params.get('days')) || 30) as Days;
  const author = params.get('author') ?? '';
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);
  const [sort, setSort] = useState<SortKey>('views');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setError(false);
    api<Stats>(`/stats?days=${days}${author ? `&author=${author}` : ''}`)
      .then(setStats)
      .catch(() => setError(true));
  }, [days, author, reload]);

  const set = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });

  const posts = useMemo(() => [...(stats?.posts ?? [])].sort((a, b) => b[sort] - a[sort]), [stats, sort]);

  const filters = (
    <>
      <Select<string>
        label={t('stats.period')}
        value={String(days)}
        onChange={(value) => set('days', value === '30' ? '' : value)}
        options={[7, 30, 90].map((d) => ({ value: String(d), label: t('stats.lastDays', { n: d }) }))}
      />
      <UserSelect
        label={t('stats.author')}
        placeholder={t('stats.wholeSite')}
        clear={t('stats.wholeSite')}
        filter={{ posts: true }}
        value={author ? Number(author) : null}
        onChange={(id) => set('author', id ? String(id) : '')}
        align="end"
      />
    </>
  );

  if (error) {
    return (
      <>
        <PageHead title={t('nav.stats')} actions={filters} />
        <ErrorNote message={t('common.loadFailed')} onRetry={() => setReload((n) => n + 1)} />
      </>
    );
  }
  if (!stats) {
    return (
      <>
        <PageHead title={t('nav.stats')} actions={filters} />
        <Loading />
      </>
    );
  }

  const { totals, previous } = stats;
  const interactions = [
    { key: 'likes', label: t('stats.likes'), now: totals.likes, before: previous.likes },
    { key: 'comments', label: t('stats.commentsReplies'), now: totals.comments + totals.replies, before: previous.comments + previous.replies },
    { key: 'shares', label: t('stats.shares'), now: totals.shares, before: previous.shares },
    { key: 'saves', label: t('stats.saves'), now: totals.saves, before: previous.saves },
  ];
  const sortable: { key: SortKey; label: string }[] = [
    { key: 'views', label: t('stats.views') },
    { key: 'visitors', label: t('stats.visitors') },
    { key: 'avgSeconds', label: t('stats.avgTime') },
    { key: 'readThrough', label: t('stats.readThroughShort') },
    { key: 'likes', label: t('stats.likes') },
    { key: 'comments', label: t('stats.comments') },
    { key: 'shares', label: t('stats.shares') },
    { key: 'saves', label: t('stats.saves') },
  ];
  const maxViews = Math.max(1, ...posts.map((p) => p.views));

  return (
    <>
      <PageHead
        title={stats.author ? t('stats.titleAuthor', { name: stats.author.name }) : t('nav.stats')}
        subtitle={t('stats.subtitle', { days })}
        actions={filters}
      />

      <div className="adm-kpis">
        <Kpi icon={Eye} label={t('stats.views')} value={formatNumber(totals.pageViews)} delta={<Delta now={totals.pageViews} before={previous.pageViews} />} spark={stats.daily.map((d) => d.views)} />
        <Kpi icon={Users} label={t('stats.visitors')} value={formatNumber(totals.visitors)} delta={<Delta now={totals.visitors} before={previous.visitors} />} spark={stats.daily.map((d) => d.visitors)} />
        <Kpi icon={Clock} label={t('stats.avgTime')} value={duration(totals.avgSeconds)} delta={<Delta now={totals.avgSeconds} before={previous.avgSeconds} />} note={t('stats.perPost')} />
        <Kpi
          icon={BookOpenCheck}
          label={t('stats.readThrough')}
          value={`${totals.readThrough}%`}
          delta={<Delta now={totals.readThrough} before={previous.readThrough} points />}
          note={t('stats.readThroughNote')}
        />
      </div>

      <div className="adm-grid is-2-1">
        <Card title={t('stats.traffic')}>
          <TrafficChart days={stats.daily} height={260} />
        </Card>
        <Card title={t('stats.interactions')}>
          <ul className="adm-metrics">
            {interactions.map((row) => (
              <li key={row.key}>
                <span>{row.label}</span>
                <strong>{formatNumber(row.now)}</strong>
                <Delta now={row.now} before={row.before} />
              </li>
            ))}
          </ul>
          <dl className="adm-facts">
            <div>
              <dt>{t('stats.timeToLike')}</dt>
              <dd>{duration(totals.secondsToLike)}</dd>
            </div>
            <div>
              <dt>{t('stats.timeToComment')}</dt>
              <dd>{duration(totals.secondsToComment)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card
        title={t('stats.posts')}
        flush
        actions={
          <Select<SortKey> label={t('stats.sortBy')} value={sort} onChange={setSort} options={sortable.map((s) => ({ value: s.key, label: t('stats.sortByX', { x: s.label }) }))} />
        }
      >
        {posts.length === 0 ? (
          <p className="adm-muted adm-pad">{t('stats.noPosts')}</p>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table is-stats">
              <thead>
                <tr>
                  <th scope="col">{t('stats.post')}</th>
                  {sortable.map((s) => (
                    <th key={s.key} scope="col" className="is-num">
                      <button type="button" className={`adm-sort${sort === s.key ? ' is-active' : ''}`} onClick={() => setSort(s.key)}>
                        {s.label}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">
                      <Link to={`/posts/${p.slug}`} className="adm-cell-title">
                        {p.title}
                      </Link>
                      <div className="adm-bar-track is-inline" aria-hidden="true">
                        <div className="adm-bar-fill" style={{ width: `${(p.views / maxViews) * 100}%` }} />
                      </div>
                    </th>
                    <td className="is-num" data-label={t('stats.views')}>
                      {formatNumber(p.views)}
                    </td>
                    <td className="is-num" data-label={t('stats.visitors')}>
                      {formatNumber(p.visitors)}
                    </td>
                    <td className="is-num" data-label={t('stats.avgTime')}>
                      {duration(p.avgSeconds)}
                    </td>
                    <td className="is-num" data-label={t('stats.readThroughShort')}>
                      {p.readThrough}%
                    </td>
                    <td className="is-num" data-label={t('stats.likes')}>
                      {formatNumber(p.likes)}
                    </td>
                    <td className="is-num" data-label={t('stats.comments')}>
                      {formatNumber(p.comments)}
                    </td>
                    <td className="is-num" data-label={t('stats.shares')}>
                      {formatNumber(p.shares)}
                    </td>
                    <td className="is-num" data-label={t('stats.saves')}>
                      {formatNumber(p.saves)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="adm-grid is-3">
        <Card title={t('stats.referrers')}>
          <BarList
            empty={t('stats.nothingYet')}
            rows={stats.referrers.map((r) => ({ key: r.host ?? '-', label: r.host ?? tb('stats.direct'), value: r.views }))}
          />
        </Card>
        <Card title={t('stats.devices')}>
          {stats.devices.length === 0 ? (
            <p className="adm-muted adm-small">{t('stats.nothingYet')}</p>
          ) : (
            <Donut
              centerLabel={t('stats.views').toLowerCase()}
              rows={['mobile', 'desktop', 'tablet'].map((device) => ({
                key: device,
                label: tb(`stats.device.${device}` as MessageKey),
                value: stats.devices.find((d) => d.device === device)?.views ?? 0,
              }))}
            />
          )}
        </Card>
        <Card title={t('stats.actions')}>
          <BarList
            empty={t('stats.nothingYet')}
            rows={stats.actions.map((a) => ({ key: a.action, label: tb(`stats.action.${a.action}` as MessageKey), value: a.times, note: t('stats.byVisitors', { n: a.visitors }) }))}
          />
        </Card>
      </div>

      {(stats.pages.length > 0 || stats.community) && (
        <div className="adm-grid is-2">
          {stats.pages.length > 0 && (
            <Card title={t('stats.pages')}>
              <BarList empty={t('stats.nothingYet')} rows={stats.pages.map((p) => ({ key: p.path, label: p.path, value: p.views, note: t('stats.byVisitors', { n: p.visitors }) }))} />
            </Card>
          )}
          {stats.community && (
            <Card title={t('stats.community')}>
              <dl className="adm-facts is-grid">
                {(
                  [
                    ['stats.c.accounts', stats.community.accounts],
                    ['stats.c.writers', stats.community.writers],
                    ['stats.c.newAccounts', stats.community.newAccounts],
                    ['stats.c.pushReaders', stats.community.pushReaders],
                    ['stats.c.pushWriters', stats.community.pushWriters],
                    ['stats.c.reactions', stats.community.reactions],
                    ['stats.c.likesTakenBack', stats.community.likesTakenBack],
                    ['stats.c.commentsDeleted', stats.community.commentsDeleted],
                    ['stats.c.commentEdits', stats.community.commentEdits],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key}>
                    <dt>{t(key)}</dt>
                    <dd>{formatNumber(value)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>
      )}
      {!author && <SearchInsightsCards days={days} />}
      <p className="adm-muted adm-small adm-footnote">{t('stats.consentNote')}</p>
    </>
  );
}
