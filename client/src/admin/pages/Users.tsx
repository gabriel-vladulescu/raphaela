import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Ban, CalendarClock, ChevronRight, MailCheck, MessageSquare, RotateCcw, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { FinalizeDialog } from '@/admin/FinalizeDialog';
import { InviteDialog, InviteIcon, InvitesCard } from '@/admin/Invites';
import { useDescribe } from '@/admin/pages/Log';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import { SuspendDialog } from '@/admin/SuspendDialog';
import type { AdminUser, AdminUserDetail, LogEntry, LogPage, UserList, UserStatus } from '@/admin/types';
import { Badge, Card, ConfirmDialog, Dialog, Empty, ErrorNote, LoadMore, Loading, PageHead, roleKey, SearchBox, Select, Tabs } from '@/admin/ui';
import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { articlesPath } from '@/lib/paths';

const PAGE = 25;
const STATUSES: UserStatus[] = ['all', 'active', 'suspended', 'deleted', 'due', 'unverified'];
const SORTS = ['new', 'name', 'login'] as const;
type Sort = (typeof SORTS)[number];

/** The badges for an account's state: deleted, suspended, address not confirmed. */
function StatusBadges({ user }: { user: AdminUser }) {
  const { t, formatDate } = useAdminI18n();
  return (
    <>
      {user.deletedAt && (
        <Badge tone="bad" title={user.purgeOn ? t('users.purgeOn', { date: formatDate(user.purgeOn) }) : undefined}>
          {t(user.deletion?.due ? 'users.status.due' : 'users.state.deleted')}
        </Badge>
      )}
      {user.suspension && <Badge tone="bad">{t('users.state.suspended')}</Badge>}
      {!user.deletedAt && !user.emailVerified && <Badge tone="warn">{t('users.state.unverified')}</Badge>}
    </>
  );
}

/** Everyone with an account: search, filter by status and role; an account's details, role, suspension, restore. */
export function UsersPage() {
  const { t, formatNumber, formatShortDate, timeAgo } = useAdminI18n();
  const { refreshOverview } = useAdmin();
  const [params, setParams] = useSearchParams();
  const status = (STATUSES.find((s) => s === params.get('status')) ?? 'all') as UserStatus;
  const role = params.get('role') ?? '';
  const sort = (SORTS.find((s) => s === params.get('sort')) ?? 'new') as Sort;
  const q = params.get('q') ?? '';
  const openId = Number(params.get('id')) || null;
  const [data, setData] = useState<UserList | null>(null);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);
  const [inviting, setInviting] = useState(false);
  /** Changes when an invitation goes out: the list reloads. */
  const [invitesKey, setInvitesKey] = useState(0);

  const query = useCallback(
    (offset: number) => `/admin/users?status=${status}&sort=${sort}&offset=${offset}&limit=${PAGE}${q ? `&q=${encodeURIComponent(q)}` : ''}${role ? `&role=${role}` : ''}`,
    [status, sort, q, role],
  );
  const load = useCallback(() => {
    setError(false);
    api<UserList>(query(0))
      .then(setData)
      .catch(() => setError(true));
  }, [query]);
  useEffect(load, [load]);

  async function loadMore() {
    if (!data) return;
    setMore(true);
    try {
      const next = await api<UserList>(query(data.users.length));
      setData({ ...next, users: [...data.users, ...next.users.filter((u) => !data.users.some((o) => o.id === u.id))] });
    } finally {
      setMore(false);
    }
  }

  const set = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });

  return (
    <>
      <PageHead
        title={t('nav.users')}
        subtitle={t('users.subtitle')}
        actions={
          <button type="button" className="adm-btn is-primary" onClick={() => setInviting(true)}>
            <InviteIcon size={16} /> {t('invites.new')}
          </button>
        }
      />
      <Card flush>
        <div className="adm-toolbar">
          <Tabs<UserStatus>
            label={t('users.filter')}
            value={status}
            onChange={(value) => set('status', value === 'all' ? '' : value)}
            items={STATUSES.map((value) => ({ value, label: t(`users.status.${value}` as AdminKey), count: data?.counts[value] }))}
          />
          <div className="adm-toolbar-row">
            <SearchBox value={q} onChange={(value) => set('q', value)} placeholder={t('users.search')} />
            <Select<string>
              label={t('users.role')}
              value={role}
              onChange={(value) => set('role', value)}
              options={[
                { value: '', label: t('users.allRoles') },
                { value: 'member', label: t('role.member') },
                { value: 'author', label: t('role.author') },
                { value: 'owner', label: t('role.owner') },
              ]}
            />
            <Select<Sort> label={t('users.sort')} value={sort} onChange={(value) => set('sort', value === 'new' ? '' : value)} options={SORTS.map((s) => ({ value: s, label: t(`users.sort.${s}` as AdminKey) }))} />
          </div>
        </div>

        {error ? (
          <ErrorNote message={t('common.loadFailed')} onRetry={load} />
        ) : !data ? (
          <Loading />
        ) : data.users.length === 0 ? (
          <div className="adm-pad">
            <Empty icon={Users} title={t('users.none')} />
          </div>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table is-cards is-clickable">
              <thead>
                <tr>
                  <th scope="col">{t('users.person')}</th>
                  <th scope="col">{t('users.role')}</th>
                  <th scope="col">{t('users.state')}</th>
                  <th scope="col">{t('users.joined')}</th>
                  <th scope="col">{t('users.lastLogin')}</th>
                  <th scope="col" className="is-num">
                    {t('users.posts')}
                  </th>
                  <th scope="col" className="is-num">
                    {t('users.comments')}
                  </th>
                  <th scope="col" className="is-actions">
                    <span className="adm-visually-hidden">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} className={u.deletedAt ? 'is-muted' : undefined} onClick={() => set('id', String(u.id))}>
                    <th scope="row">
                      <span className="adm-person is-stacked">
                        <Avatar name={u.name} picture={u.picture} size={32} />
                        <span>
                          <span className="adm-cell-title">{u.name}</span>
                          <span className="adm-muted adm-small">{u.email}</span>
                        </span>
                      </span>
                    </th>
                    <td data-label={t('users.role')}>
                      <Badge tone={u.role === 'member' ? 'neutral' : 'accent'}>{t(roleKey(u.role))}</Badge>
                    </td>
                    <td data-label={t('users.state')}>
                      <span className="adm-badges">
                        <StatusBadges user={u} />
                        {!u.deletedAt && !u.suspension && u.emailVerified && <Badge tone="good">{t('users.state.active')}</Badge>}
                      </span>
                    </td>
                    <td data-label={t('users.joined')} className="adm-nowrap">
                      {formatShortDate(u.createdAt)}
                    </td>
                    <td data-label={t('users.lastLogin')} className="adm-nowrap">
                      {u.lastLoginAt ? timeAgo(u.lastLoginAt) : '—'}
                    </td>
                    <td className="is-num" data-label={t('users.posts')}>
                      {formatNumber(u.postCount)}
                    </td>
                    <td className="is-num" data-label={t('users.comments')}>
                      {formatNumber(u.commentCount)}
                    </td>
                    <td className="is-actions">
                      <button type="button" className="adm-icon-btn" aria-label={t('users.details')} title={t('users.details')}>
                        <ChevronRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.hasMore && <LoadMore busy={more} onClick={() => void loadMore()} />}
      </Card>

      <InvitesCard key={invitesKey} />
      {inviting && <InviteDialog onClose={() => setInviting(false)} onSent={() => setInvitesKey((key) => key + 1)} />}

      {openId && (
        <UserDrawer
          id={openId}
          onClose={() => set('id', '')}
          onChanged={() => {
            load();
            refreshOverview();
          }}
        />
      )}
    </>
  );
}

/** One account: who, its numbers, its state, and what an administrator can do about it. */
function UserDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { t, formatDate, formatDateTime, timeAgo, formatNumber, errorMessage } = useAdminI18n();
  const { user: me } = useAuth();
  const [data, setData] = useState<{ user: AdminUserDetail; comments: { id: number; body: string; createdAt: string; deleted: boolean; post: { title: string; slug: string }; openReports: number }[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [confirm, setConfirm] = useState<'lift' | 'restore' | null>(null);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const describe = useDescribe();

  const load = useCallback(() => {
    api<NonNullable<typeof data>>(`/admin/users/${id}`)
      .then(setData)
      .catch((err) => setError(errorMessage(err)));
    // What administrators did to this account.
    api<LogPage>(`/admin/log?targetType=user&targetId=${id}&limit=8`)
      .then((page) => setHistory(page.entries))
      .catch(() => setHistory([]));
  }, [id]);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      setConfirm(null);
      load();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const u = data?.user;
  const editable = u && u.role !== 'owner' && u.id !== me?.id && !u.deletedAt;

  return (
    <Dialog title={u?.name ?? t('users.details')} onClose={onClose} drawer>
      {!data ? (
        error ? <ErrorNote message={error} /> : <Loading />
      ) : (
        <div className="adm-user">
          <div className="adm-user-head">
            <Avatar name={u!.name} picture={u!.picture} size={56} />
            <div>
              <strong>{u!.name}</strong>
              <span className="adm-muted">{u!.email}</span>
              <span className="adm-badges">
                <Badge tone={u!.role === 'member' ? 'neutral' : 'accent'}>{t(roleKey(u!.role))}</Badge>
                <StatusBadges user={u!} />
                {u!.google && <Badge>Google</Badge>}
              </span>
            </div>
          </div>

          {u!.deletedAt && u!.deletion && (
            <div className="adm-callout is-bad">
              <strong>{t('users.deletedTitle')}</strong>
              <p>
                {t(u!.deletion.due ? 'users.deletedDueBody' : 'users.deletedBody', { deleted: formatDate(u!.deletedAt), purge: formatDate(u!.purgeOn!) })}
              </p>
              <ul className="adm-choices is-compact">
                <li>
                  <span>{t('finalize.comments')}</span>
                  <Badge tone={u!.deletion.comments === 'delete' ? 'bad' : 'neutral'}>{t(u!.deletion.comments === 'delete' ? 'deletion.delete' : 'deletion.keep')}</Badge>
                  {u!.deletedWithAccount.comments > 0 && <span className="adm-muted adm-small">{t('users.hiddenComments', { n: u!.deletedWithAccount.comments })}</span>}
                </li>
                {u!.deletion.postsTotal > 0 && (
                  <li>
                    <span>{t('finalize.posts', { n: u!.deletion.postsTotal })}</span>
                    <Badge tone={u!.deletion.posts === 'delete' ? 'bad' : 'neutral'}>{t(u!.deletion.posts === 'delete' ? 'deletion.delete' : 'deletion.keep')}</Badge>
                  </li>
                )}
              </ul>
              <div className="adm-user-buttons">
                <button type="button" className="adm-btn is-small" disabled={busy} onClick={() => setConfirm('restore')}>
                  <RotateCcw size={14} /> {t('users.restore')}
                </button>
                {u!.deletion.due && (
                  <button type="button" className="adm-btn is-small is-danger" onClick={() => setFinalizing(true)}>
                    <Trash2 size={14} /> {t('finalize.submit')}
                  </button>
                )}
              </div>
            </div>
          )}
          {u!.suspension && (
            <div className="adm-callout is-bad">
              <strong>{u!.suspension.until ? t('users.suspendedUntil', { date: formatDateTime(u!.suspension.until) }) : t('users.suspendedForever')}</strong>
              <p>
                {t('users.suspendedSince', { date: formatDateTime(u!.suspension.since), by: u!.suspension.by ?? '—' })}
                {u!.suspension.reason && (
                  <>
                    <br />
                    {t('users.reason')}: {u!.suspension.reason}
                  </>
                )}
              </p>
              {editable && (
                <button type="button" className="adm-btn is-small" disabled={busy} onClick={() => setConfirm('lift')}>
                  <ShieldCheck size={14} /> {t('users.lift')}
                </button>
              )}
            </div>
          )}

          <dl className="adm-facts is-grid">
            <div>
              <dt>{t('users.joined')}</dt>
              <dd>{formatDate(u!.createdAt)}</dd>
            </div>
            <div>
              <dt>{t('users.lastLogin')}</dt>
              <dd>{u!.lastLoginAt ? timeAgo(u!.lastLoginAt) : '—'}</dd>
            </div>
            <div>
              <dt>{t('users.posts')}</dt>
              <dd>{formatNumber(u!.postCount)}</dd>
            </div>
            <div>
              <dt>{t('users.comments')}</dt>
              <dd>{formatNumber(u!.commentCount)}</dd>
            </div>
            <div>
              <dt>{t('users.likes')}</dt>
              <dd>{formatNumber(u!.likeCount)}</dd>
            </div>
            <div>
              <dt>{t('users.reportsReceived')}</dt>
              <dd>{formatNumber(u!.reportsReceived)}</dd>
            </div>
            <div>
              <dt>{t('users.reportsMade')}</dt>
              <dd>{formatNumber(u!.reportsMade)}</dd>
            </div>
            <div>
              <dt>{t('users.sessions')}</dt>
              <dd>{formatNumber(u!.sessions)}</dd>
            </div>
            <div>
              <dt>{t('users.signIn')}</dt>
              <dd>{[u!.hasPassword && t('users.password'), u!.google && 'Google'].filter(Boolean).join(' + ') || '—'}</dd>
            </div>
            <div>
              <dt>{t('users.terms')}</dt>
              <dd>{u!.termsAcceptedAt ? formatDate(u!.termsAcceptedAt) : '—'}</dd>
            </div>
          </dl>

          {editable && (
            <section className="adm-user-section">
              <h3>{t('users.manage')}</h3>
              <div className="adm-user-row">
                <span>{t('users.role')}</span>
                <Select<string>
                  label={t('users.role')}
                  value={u!.role}
                  onChange={(value) => void run(() => api(`/admin/users/${u!.id}/role`, { method: 'PATCH', body: { role: value } }))}
                  options={[
                    { value: 'member', label: t('role.member') },
                    { value: 'author', label: t('role.author') },
                  ]}
                />
              </div>
              <div className="adm-user-buttons">
                {!u!.emailVerified && (
                  <button type="button" className="adm-btn is-small" disabled={busy} onClick={() => void run(() => api(`/admin/users/${u!.id}/verify-email`, { method: 'POST' }))}>
                    <MailCheck size={14} /> {t('users.markVerified')}
                  </button>
                )}
                {!u!.suspension && (
                  <button type="button" className="adm-btn is-small is-danger-ghost" onClick={() => setSuspending(true)}>
                    <Ban size={14} /> {t('users.suspend')}
                  </button>
                )}
              </div>
            </section>
          )}
          {u!.role === 'owner' && <p className="adm-muted adm-small">{t('users.ownerLocked')}</p>}
          {error && <p className="adm-form-error">{error}</p>}

          <section className="adm-user-section">
            <h3>
              {t('users.recentComments')}
              {u!.commentCount > 0 && (
                <Link to={`/admin/comentarii?filter=all&user=${u!.id}`} className="adm-link">
                  {t('common.all')} <ChevronRight size={14} />
                </Link>
              )}
            </h3>
            {data.comments.length === 0 ? (
              <p className="adm-muted adm-small">{t('comments.none')}</p>
            ) : (
              <ul className="adm-feed is-compact">
                {data.comments.map((c) => (
                  <li key={c.id}>
                    <MessageSquare size={15} className="adm-muted" aria-hidden="true" />
                    <div>
                      <p className="adm-clamp">{c.body}</p>
                      <span className="adm-muted adm-small">
                        <Link to={`/posts/${c.post.slug}`}>{c.post.title}</Link> · {timeAgo(c.createdAt)}
                        {c.deleted && <> · {t('comments.deleted')}</>}
                        {c.openReports > 0 && <> · {t('comments.reportsN', { n: c.openReports })}</>}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {history.length > 0 && (
            <section className="adm-user-section">
              <h3>
                {t('users.adminHistory')}
                <Link to={`/admin/jurnal?q=${encodeURIComponent(u!.email)}`} className="adm-link">
                  {t('common.all')} <ChevronRight size={14} />
                </Link>
              </h3>
              <ul className="adm-feed is-compact">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <ShieldCheck size={15} className="adm-muted" aria-hidden="true" />
                    <div>
                      <p>
                        <strong>{entry.admin.name}</strong> {describe(entry)}
                      </p>
                      <span className="adm-muted adm-small">{formatDateTime(entry.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {u!.username && !u!.deletedAt && u!.postCount > 0 && (
            <Link to={articlesPath(u!.username)} className="adm-link">
              <CalendarClock size={14} /> {t('users.theirPosts')}
            </Link>
          )}
        </div>
      )}

      {finalizing && u && (
        <FinalizeDialog
          user={u}
          onClose={() => setFinalizing(false)}
          onDone={() => {
            setFinalizing(false);
            onChanged();
            onClose();
          }}
        />
      )}
      {suspending && u && (
        <SuspendDialog
          user={u}
          onClose={() => setSuspending(false)}
          onDone={() => {
            setSuspending(false);
            load();
            onChanged();
          }}
        />
      )}
      {confirm && u && (
        <ConfirmDialog
          title={t(confirm === 'lift' ? 'users.lift' : 'users.restore')}
          body={t(confirm === 'lift' ? 'users.liftBody' : 'users.restoreBody', { name: u.name, email: u.email })}
          confirmLabel={t(confirm === 'lift' ? 'users.lift' : 'users.restore')}
          busy={busy}
          error={error}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            void run(() => api(confirm === 'lift' ? `/admin/users/${u.id}/suspend` : `/admin/users/${u.id}/restore`, { method: confirm === 'lift' ? 'DELETE' : 'POST' }))
          }
        />
      )}
    </Dialog>
  );
}
