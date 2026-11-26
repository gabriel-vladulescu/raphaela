import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, BellRing, CircleCheck, KeyRound, MessageSquareText, Trash2 } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import { CleanupSettings } from '@/admin/pages/Cleanup';
import type { AuthPage, EditPage, ErrorPage, HistoryKind, PushPage } from '@/admin/types';
import { Badge, Card, ConfirmDialog, Empty, ErrorNote, LoadMore, Loading, periodQuery, SearchBox, Select, Tabs } from '@/admin/ui';
import type { Tone } from '@/admin/ui';
import { UserSelect } from '@/admin/UserSelect';
import { Avatar } from '@/components/Avatar';
import { api } from '@/lib/api';

// Logs' tabs (the page is Log.tsx): sign-in attempts, pushes, the server's errors, comments' earlier versions, and
// clearing by period. Each keeps its filters in the address, with the period the tabs share (?from=…&to=…).

/** The address's filters, and a setter for one of them. */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  return { params, set, period: periodQuery(params) };
}

/** A list read page by page: the first page for `query`, and "load more" adding the next one to `key`'s items. */
function usePaged<P extends { hasMore: boolean }>(query: (offset: number) => string, key: keyof P) {
  const [data, setData] = useState<P | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    api<P>(query(0))
      .then(setData)
      .catch(() => setFailed(true));
  }, [query]);
  useEffect(load, [load]);
  async function loadMore() {
    if (!data) return;
    setMore(true);
    try {
      const next = await api<P>(query((data[key] as unknown[]).length));
      setData({ ...next, [key]: [...(data[key] as unknown[]), ...(next[key] as unknown[])] });
    } finally {
      setMore(false);
    }
  }
  return { data, failed, more, load, loadMore };
}

const enc = encodeURIComponent;

// ---- Sign-ins

const OUTCOME_TONE: Record<string, Tone> = { ok: 'good', wrong_password: 'bad', unknown_email: 'warn', google_only: 'info', suspended: 'bad', deleted: 'bad', failed: 'bad' };
const METHODS = ['password', 'google', 'signup', 'reset', 'invite'] as const;

/** Every sign-in attempt: how, how it went, the account (or the address typed), the browser. */
export function AuthTab() {
  const { t, formatDateTime, formatNumber } = useAdminI18n();
  const { params, set, period } = useFilters();
  const outcome = (['all', 'ok', 'failed'] as const).find((value) => value === params.get('outcome')) ?? 'all';
  const method = params.get('method') ?? '';
  const user = params.get('user') ?? '';
  const q = params.get('q') ?? '';
  const query = useCallback(
    (offset: number) =>
      `/admin/history/auth?offset=${offset}&limit=30${outcome !== 'all' ? `&outcome=${outcome}` : ''}${method ? `&method=${method}` : ''}${user ? `&user=${user}` : ''}${q ? `&q=${enc(q)}` : ''}${period}`,
    [outcome, method, user, q, period],
  );
  const { data, failed, more, load, loadMore } = usePaged<AuthPage>(query, 'attempts');

  return (
    <>
      {data && (
        <div className="adm-kpis is-3">
          <div className="adm-kpi">
            <div className="adm-kpi-top">{t('auth.failedDay')}</div>
            <div className={`adm-kpi-value${data.failedDay ? ' is-bad' : ''}`}>{formatNumber(data.failedDay)}</div>
          </div>
          <div className="adm-kpi">
            <div className="adm-kpi-top">{t('auth.ok')}</div>
            <div className="adm-kpi-value">{formatNumber(data.counts.ok)}</div>
          </div>
          <div className="adm-kpi">
            <div className="adm-kpi-top">{t('auth.total')}</div>
            <div className="adm-kpi-value">{formatNumber(data.counts.all)}</div>
            <span className="adm-muted adm-small">{t('auth.kept')}</span>
          </div>
        </div>
      )}
      <Card flush>
        <div className="adm-toolbar">
          <Tabs
            label={t('auth.outcome')}
            value={outcome}
            onChange={(value) => set('outcome', value === 'all' ? '' : value)}
            items={(['all', 'ok', 'failed'] as const).map((value) => ({ value, label: t(`auth.filter.${value}` as AdminKey), count: data?.counts[value] }))}
          />
          <div className="adm-toolbar-row">
            <SearchBox value={q} onChange={(value) => set('q', value)} placeholder={t('auth.search')} />
            <Select<string>
              label={t('auth.method')}
              value={method}
              onChange={(value) => set('method', value)}
              options={[{ value: '', label: t('auth.allMethods') }, ...METHODS.map((value) => ({ value, label: t(`auth.method.${value}` as AdminKey) }))]}
            />
            <UserSelect
              label={t('auth.account')}
              placeholder={t('auth.allAccounts')}
              clear={t('auth.allAccounts')}
              value={user ? Number(user) : null}
              onChange={(id) => set('user', id ? String(id) : '')}
            />
          </div>
        </div>
        {failed ? (
          <ErrorNote message={t('common.loadFailed')} onRetry={load} />
        ) : !data ? (
          <Loading />
        ) : data.attempts.length === 0 ? (
          <div className="adm-pad">
            <Empty icon={KeyRound} title={t('auth.none')} body={t('auth.noneBody')} />
          </div>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table is-cards adm-auth-table">
              <thead>
                <tr>
                  <th scope="col">{t('auth.who')}</th>
                  <th scope="col">{t('auth.outcome')}</th>
                  <th scope="col">{t('auth.method')}</th>
                  <th scope="col">{t('auth.device')}</th>
                  <th scope="col">{t('auth.when')}</th>
                </tr>
              </thead>
              <tbody>
                {data.attempts.map((a) => (
                  <tr key={a.id} className={a.outcome === 'ok' ? undefined : 'is-failed'}>
                    <th scope="row">
                      {a.user ? (
                        <Link to={`/admin/utilizatori?id=${a.user.id}`} className="adm-person">
                          <Avatar name={a.user.name} picture={a.user.picture} size={26} />
                          <span className="adm-cell-title">{a.user.name}</span>
                        </Link>
                      ) : (
                        <span className="adm-cell-title">{a.email ?? '—'}</span>
                      )}
                      {a.user && a.email && <span className="adm-muted adm-small adm-break">{a.email}</span>}
                    </th>
                    <td data-label={t('auth.outcome')}>
                      <Badge tone={OUTCOME_TONE[a.outcome] ?? 'neutral'}>{t(`auth.outcome.${a.outcome}` as AdminKey)}</Badge>
                    </td>
                    <td data-label={t('auth.method')}>{t(`auth.method.${a.method}` as AdminKey)}</td>
                    <td data-label={t('auth.device')}>{a.device ?? <span className="adm-muted">—</span>}</td>
                    <td data-label={t('auth.when')} className="adm-nowrap">
                      <time dateTime={a.createdAt}>{formatDateTime(a.createdAt)}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.hasMore && <LoadMore busy={more} onClick={() => void loadMore()} />}
      </Card>
    </>
  );
}

// ---- Pushes

/** The pushes sent: what, to how many devices, how many got it; and the devices that get them. */
export function PushTab() {
  const { t, formatDateTime, formatNumber } = useAdminI18n();
  const { params, set, period } = useFilters();
  const kind = params.get('kind') ?? '';
  const user = params.get('user') ?? '';
  const q = params.get('q') ?? '';
  const [open, setOpen] = useState<number | null>(null);
  const query = useCallback(
    (offset: number) => `/admin/history/push?offset=${offset}&limit=30${kind ? `&kind=${kind}` : ''}${user ? `&user=${user}` : ''}${q ? `&q=${enc(q)}` : ''}${period}`,
    [kind, user, q, period],
  );
  const { data, failed, more, load, loadMore } = usePaged<PushPage>(query, 'pushes');
  const kindLabel = (value: string) => t(`push.kind.${value}` as AdminKey);

  return (
    <>
      {data && (
        <div className="adm-kpis">
          <div className="adm-kpi">
            <div className="adm-kpi-top">{t('push.devices')}</div>
            <div className="adm-kpi-value">{formatNumber(data.devices.total)}</div>
            <span className="adm-muted adm-small">{t('push.devicesHint', { guests: data.devices.guests, accounts: data.devices.accounts })}</span>
          </div>
          <div className="adm-kpi">
            <div className="adm-kpi-top">{t('push.newPosts')}</div>
            <div className="adm-kpi-value">{formatNumber(data.devices.newPosts + data.devices.activity)}</div>
            <span className="adm-muted adm-small">{t('push.newPostsHint', { guests: data.devices.newPosts, accounts: data.devices.activity })}</span>
          </div>
          <div className="adm-kpi">
            <div className="adm-kpi-top">{t('push.books')}</div>
            <div className="adm-kpi-value">{formatNumber(data.devices.bookDevices)}</div>
            <span className="adm-muted adm-small">{t('push.booksHint', { n: data.devices.bookFollows })}</span>
          </div>
          <div className="adm-kpi">
            <div className="adm-kpi-top">{t('push.day')}</div>
            <div className={`adm-kpi-value${data.day.failed ? ' is-bad' : ''}`}>{formatNumber(data.day.sent)}</div>
            <span className="adm-muted adm-small">{t('push.dayHint', { pushes: data.day.pushes, failed: data.day.failed })}</span>
          </div>
        </div>
      )}
      <Card flush>
        <div className="adm-toolbar adm-toolbar-plain">
          <div className="adm-toolbar-row">
            <SearchBox value={q} onChange={(value) => set('q', value)} placeholder={t('push.search')} />
            <Select<string>
              label={t('push.kind')}
              value={kind}
              onChange={(value) => set('kind', value)}
              options={[{ value: '', label: t('push.allKinds') }, ...(data?.kinds ?? []).map((k) => ({ value: k.kind, label: `${kindLabel(k.kind)} (${k.count})` }))]}
            />
            <UserSelect
              label={t('push.account')}
              placeholder={t('push.allAccounts')}
              clear={t('push.allAccounts')}
              value={user ? Number(user) : null}
              onChange={(id) => set('user', id ? String(id) : '')}
            />
          </div>
        </div>
        {failed ? (
          <ErrorNote message={t('common.loadFailed')} onRetry={load} />
        ) : !data ? (
          <Loading />
        ) : data.pushes.length === 0 ? (
          <div className="adm-pad">
            <Empty icon={BellRing} title={t('push.none')} body={t('push.noneBody')} />
          </div>
        ) : (
          <ul className="adm-emails">
            {data.pushes.map((push) => (
              <li key={push.id} className={push.failed ? 'is-failed' : undefined}>
                <button type="button" className="adm-email" aria-expanded={open === push.id} onClick={() => setOpen(open === push.id ? null : push.id)}>
                  <Badge tone={push.failed ? 'bad' : push.sent ? 'good' : 'neutral'}>
                    {formatNumber(push.sent)}/{formatNumber(push.devices)}
                  </Badge>
                  <span className="adm-email-main">
                    <strong>{push.title}</strong>
                    <span className="adm-muted adm-small">
                      {kindLabel(push.kind)}
                      {push.user && <> · {push.user.name}</>}
                      {push.gone > 0 && <> · {t('push.gone', { n: push.gone })}</>}
                      {push.failed > 0 && <> · {t('push.failed', { n: push.failed })}</>}
                    </span>
                  </span>
                  <time className="adm-muted adm-small adm-nowrap" dateTime={push.createdAt}>
                    {formatDateTime(push.createdAt)}
                  </time>
                </button>
                {open === push.id && (
                  <div className="adm-email-detail">
                    <p className="adm-small">
                      {t('push.counts', { devices: push.devices, sent: push.sent, failed: push.failed, gone: push.gone })}
                      {push.url && (
                        <>
                          {' · '}
                          <a href={push.url} target="_blank" rel="noopener noreferrer" className="adm-link">
                            {push.url}
                          </a>
                        </>
                      )}
                      {push.user && (
                        <>
                          {' · '}
                          <Link to={`/admin/utilizatori?id=${push.user.id}`} className="adm-link">
                            {push.user.name}
                          </Link>
                        </>
                      )}
                    </p>
                    {push.error && <pre className="adm-email-error">{push.error}</pre>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {data?.hasMore && <LoadMore busy={more} onClick={() => void loadMore()} />}
      </Card>
    </>
  );
}

// ---- Errors

/** The server's errors, the latest first: where, what, how many times; opening the tab marks them seen. */
export function ErrorsTab() {
  const { t, formatDateTime, formatNumber } = useAdminI18n();
  const { refreshOverview } = useAdmin();
  const { params, set, period } = useFilters();
  const source = params.get('source') ?? '';
  const q = params.get('q') ?? '';
  const [open, setOpen] = useState<number | null>(null);
  const query = useCallback(
    (offset: number) => `/admin/history/errors?offset=${offset}&limit=30${source ? `&source=${source}` : ''}${q ? `&q=${enc(q)}` : ''}${period}`,
    [source, q, period],
  );
  const { data, failed, more, load, loadMore } = usePaged<ErrorPage>(query, 'errors');
  // The first page marked them seen: the menu's count goes.
  useEffect(() => {
    if (data) refreshOverview();
  }, [data === null]);

  return (
    <>
      {data && (
        <div className="adm-kpis is-3">
          <div className="adm-kpi">
            <div className="adm-kpi-top">{t('errors.day')}</div>
            <div className={`adm-kpi-value${data.counts.day ? ' is-bad' : ''}`}>{formatNumber(data.counts.day)}</div>
          </div>
          <div className="adm-kpi">
            <div className="adm-kpi-top">{t('errors.unseen')}</div>
            <div className="adm-kpi-value">{formatNumber(data.counts.unseen)}</div>
          </div>
          <div className="adm-kpi">
            <div className="adm-kpi-top">{t('errors.total')}</div>
            <div className="adm-kpi-value">{formatNumber(data.counts.all)}</div>
            <span className="adm-muted adm-small">{t('errors.kept')}</span>
          </div>
        </div>
      )}
      <Card flush>
        <div className="adm-toolbar adm-toolbar-plain">
          <div className="adm-toolbar-row">
            <SearchBox value={q} onChange={(value) => set('q', value)} placeholder={t('errors.search')} />
            <Select<string>
              label={t('errors.source')}
              value={source}
              onChange={(value) => set('source', value)}
              options={[
                { value: '', label: t('errors.allSources') },
                ...(data?.sources ?? []).map((s) => ({ value: s.source, label: `${t(`errors.source.${s.source}` as AdminKey)} (${s.count})` })),
              ]}
            />
          </div>
        </div>
        {failed ? (
          <ErrorNote message={t('common.loadFailed')} onRetry={load} />
        ) : !data ? (
          <Loading />
        ) : data.errors.length === 0 ? (
          <div className="adm-pad">
            <Empty icon={CircleCheck} title={t('errors.none')} body={t('errors.noneBody')} />
          </div>
        ) : (
          <ul className="adm-emails">
            {data.errors.map((error) => (
              <li key={error.id} className={error.seen ? undefined : 'is-failed'}>
                <button type="button" className="adm-email" aria-expanded={open === error.id} onClick={() => setOpen(open === error.id ? null : error.id)}>
                  <Badge tone={error.seen ? 'neutral' : 'bad'}>{t(`errors.source.${error.source}` as AdminKey)}</Badge>
                  <span className="adm-email-main">
                    <strong>{error.message}</strong>
                    <span className="adm-muted adm-small">
                      {error.context}
                      {error.times > 1 && <> · {t('errors.times', { n: error.times })}</>}
                      {!error.seen && <> · {t('errors.new')}</>}
                    </span>
                  </span>
                  <time className="adm-muted adm-small adm-nowrap" dateTime={error.lastAt}>
                    {formatDateTime(error.lastAt)}
                  </time>
                </button>
                {open === error.id && (
                  <div className="adm-email-detail">
                    <p className="adm-small">
                      {t('errors.first', { date: formatDateTime(error.createdAt) })}
                      {error.times > 1 && <> · {t('errors.last', { date: formatDateTime(error.lastAt) })}</>}
                      {error.user && (
                        <>
                          {' · '}
                          <Link to={`/admin/utilizatori?id=${error.user.id}`} className="adm-link">
                            {error.user.name}
                          </Link>
                        </>
                      )}
                    </p>
                    {error.detail && <pre className="adm-email-error adm-stack">{error.detail}</pre>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {data?.hasMore && <LoadMore busy={more} onClick={() => void loadMore()} />}
      </Card>
    </>
  );
}

// ---- Comment edits

/** Comments' earlier versions, the latest first: what it said, and what it says now. */
export function EditsTab() {
  const { t, formatDateTime } = useAdminI18n();
  const { params, set, period } = useFilters();
  const user = params.get('user') ?? '';
  const q = params.get('q') ?? '';
  const query = useCallback(
    (offset: number) => `/admin/history/edits?offset=${offset}&limit=30${user ? `&user=${user}` : ''}${q ? `&q=${enc(q)}` : ''}${period}`,
    [user, q, period],
  );
  const { data, failed, more, load, loadMore } = usePaged<EditPage>(query, 'edits');

  return (
    <Card flush>
      <div className="adm-toolbar adm-toolbar-plain">
        <div className="adm-toolbar-row">
          <SearchBox value={q} onChange={(value) => set('q', value)} placeholder={t('edits.search')} />
          <UserSelect
            label={t('edits.author')}
            placeholder={t('edits.allAuthors')}
            clear={t('edits.allAuthors')}
            value={user ? Number(user) : null}
            onChange={(id) => set('user', id ? String(id) : '')}
          />
        </div>
      </div>
      {failed ? (
        <ErrorNote message={t('common.loadFailed')} onRetry={load} />
      ) : !data ? (
        <Loading />
      ) : data.edits.length === 0 ? (
        <div className="adm-pad">
          <Empty icon={MessageSquareText} title={t('edits.none')} body={t('edits.noneBody')} />
        </div>
      ) : (
        <ul className="adm-edits">
          {data.edits.map((edit) => (
            <li key={edit.id}>
              <Avatar name={edit.author.name} picture={edit.author.picture} size={30} />
              <div className="adm-edit-main">
                <p className="adm-small">
                  <Link to={`/admin/utilizatori?id=${edit.author.id}`} className="adm-link">
                    <strong>{edit.author.name}</strong>
                  </Link>{' '}
                  · <Link to={edit.post.path}>{edit.post.title}</Link> · <time dateTime={edit.replacedAt}>{formatDateTime(edit.replacedAt)}</time>
                  {edit.deleted && (
                    <>
                      {' '}
                      <Badge tone="bad">{t('comments.deleted')}</Badge>
                    </>
                  )}
                </p>
                <div className="adm-edit-pair">
                  <div>
                    <span className="adm-edit-label">{t('edits.before')}</span>
                    <p className="adm-edit-text is-before">{edit.before}</p>
                  </div>
                  <div>
                    <span className="adm-edit-label">{t('edits.now')}</span>
                    <p className="adm-edit-text">{edit.now}</p>
                  </div>
                </div>
                <Link to={`/admin/comentarii?filter=all&user=${edit.author.id}`} className="adm-link adm-small">
                  {t('edits.open')}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data?.hasMore && <LoadMore busy={more} onClick={() => void loadMore()} />}
    </Card>
  );
}

// ---- Clean up

/**
 * Clearing the logs by period: how much each kind holds from one day to another (the period above), the kinds
 * chosen deleted after asking. Then the data past the Terms' keeping periods (Cleanup.tsx).
 */
export function CleanupTab() {
  const { t, formatNumber, formatShortDate } = useAdminI18n();
  const { refreshOverview } = useAdmin();
  const { params, period } = useFilters();
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const [kinds, setKinds] = useState<HistoryKind[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<Set<HistoryKind['key']>>(new Set());
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<number | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    api<{ kinds: HistoryKind[] }>(`/admin/history/summary?${period.slice(1)}`)
      .then((data) => setKinds(data.kinds))
      .catch(() => setFailed(true));
  }, [period]);
  useEffect(load, [load]);

  const label = (key: string) => t(`history.kind.${key}` as AdminKey);
  const picked = (kinds ?? []).filter((kind) => chosen.has(kind.key) && kind.count > 0);
  const total = picked.reduce((sum, kind) => sum + kind.count, 0);
  const toggle = (key: HistoryKind['key']) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  async function clear() {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ deleted: Record<string, number> }>('/admin/history/clear', {
        method: 'POST',
        body: { kinds: picked.map((kind) => kind.key), ...(from ? { from } : {}), ...(to ? { to } : {}) },
      });
      setDone(Object.values(data.deleted).reduce((sum, n) => sum + n, 0));
      setAsking(false);
      setChosen(new Set());
      load();
      refreshOverview();
    } catch {
      setError(t('cleanup.failed'));
    } finally {
      setBusy(false);
    }
  }

  const periodText = from || to ? t('history.period', { from: from ? formatShortDate(from) : '…', to: to ? formatShortDate(to) : '…' }) : t('history.anytime');
  return (
    <>
      <Card
        title={t('history.title')}
        actions={
          <button type="button" className="adm-btn is-danger is-small" disabled={total === 0} onClick={() => setAsking(true)}>
            <Trash2 size={15} /> {t('history.delete', { n: formatNumber(total) })}
          </button>
        }
        flush
      >
        <p className="adm-muted adm-small adm-pad adm-cleanup-intro">
          {t('history.intro')} <strong>{periodText}</strong>
        </p>
        {done !== null && (
          <p className="adm-cleanup-done" role="status">
            <CircleCheck size={16} aria-hidden="true" /> {t('cleanup.done', { n: formatNumber(done) })}
          </p>
        )}
        {failed ? (
          <div className="adm-pad">
            <ErrorNote message={t('common.loadFailed')} onRetry={load} />
          </div>
        ) : !kinds ? (
          <Loading />
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table is-cards adm-cleanup-table">
              <thead>
                <tr>
                  <th scope="col">{t('cleanup.what')}</th>
                  <th scope="col" className="is-num">
                    {t('history.inPeriod')}
                  </th>
                  <th scope="col" className="is-num">
                    {t('history.total')}
                  </th>
                  <th scope="col">{t('cleanup.oldest')}</th>
                </tr>
              </thead>
              <tbody>
                {kinds.map((kind) => (
                  <tr key={kind.key} className={kind.count === 0 ? 'is-quiet' : undefined}>
                    <th scope="row">
                      <label className="adm-check">
                        <input type="checkbox" checked={chosen.has(kind.key)} disabled={kind.count === 0} onChange={() => toggle(kind.key)} />
                        <span className="adm-cell-title">{label(kind.key)}</span>
                      </label>
                      <span className="adm-muted adm-small">{t(`history.hint.${kind.key}` as AdminKey)}</span>
                    </th>
                    <td className="is-num" data-label={t('history.inPeriod')}>
                      {kind.count > 0 ? <Badge tone={chosen.has(kind.key) ? 'bad' : 'warn'}>{formatNumber(kind.count)}</Badge> : <span className="adm-muted">0</span>}
                    </td>
                    <td className="is-num" data-label={t('history.total')}>
                      {formatNumber(kind.total)}
                    </td>
                    <td data-label={t('cleanup.oldest')} className="adm-nowrap">
                      {kind.oldest ? formatShortDate(kind.oldest) : <span className="adm-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CleanupSettings />

      {asking && (
        <ConfirmDialog
          title={t('history.confirmTitle')}
          body={
            <>
              <p>
                {t('history.confirmBody')} <strong>{periodText}</strong>
              </p>
              {!from && !to && (
                <p className="adm-callout is-bad">
                  <AlertTriangle size={16} aria-hidden="true" /> {t('history.confirmAll')}
                </p>
              )}
              <ul className="adm-cleanup-confirm">
                {picked.map((kind) => (
                  <li key={kind.key}>
                    {label(kind.key)}: <strong>{formatNumber(kind.count)}</strong>
                  </li>
                ))}
              </ul>
            </>
          }
          confirmLabel={t('history.confirm')}
          danger
          busy={busy}
          error={error}
          onCancel={() => setAsking(false)}
          onConfirm={() => void clear()}
        />
      )}
    </>
  );
}
