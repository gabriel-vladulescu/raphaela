import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AtSign, Ban, BellRing, CalendarClock, ChevronRight, History, KeyRound, LogIn, LogOut, Mail, MailCheck, MailPlus, MessageSquare, RotateCcw, Send, ShieldCheck, ShieldX, Trash2, TriangleAlert, UserPen, Users, X } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { FinalizeDialog } from '@/admin/FinalizeDialog';
import { InviteDialog, InviteIcon, InvitesCard } from '@/admin/Invites';
import { useDescribe } from '@/admin/pages/Log';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import { SuspendDialog } from '@/admin/SuspendDialog';
import type { AccountChange, AdminUser, AdminUserDetail, EmailLink, Login, LogEntry, LogPage, PendingEmail, PushDevice, SignInAttempt, UserList, UserStatus } from '@/admin/types';
import { Badge, Card, ConfirmDialog, Dialog, Empty, ErrorNote, Field, LoadMore, Loading, PageHead, roleKey, SearchBox, Select, Tabs } from '@/admin/ui';
import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/context/auth';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

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

/** The account's confirmations: their titles (the button too) and texts. */
const CONFIRM = {
  lift: { title: 'users.lift', body: 'users.liftBody' },
  restore: { title: 'users.restore', body: 'users.restoreBody' },
  sessions: { title: 'users.endSessions', body: 'users.endSessionsBody' },
  reset: { title: 'users.sendReset', body: 'users.sendResetBody' },
} as const satisfies Record<string, { title: AdminKey; body: AdminKey }>;

/** One account: who, its numbers, its state, and what an administrator can do about it. */
function UserDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { t, formatDate, formatDateTime, timeAgo, formatNumber, errorMessage } = useAdminI18n();
  const { user: me } = useAuth();
  const [data, setData] = useState<{
    user: AdminUserDetail;
    comments: { id: number; body: string; createdAt: string; deleted: boolean; post: { title: string; slug: string }; openReports: number }[];
    links: EmailLink[];
    logins: Login[];
    attempts: SignInAttempt[];
    devices: PushDevice[];
    changes: AccountChange[];
    /** A new address waiting for its link to be opened. */
    pendingEmail: PendingEmail | null;
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [confirm, setConfirm] = useState<'lift' | 'restore' | 'sessions' | 'reset' | null>(null);
  const [editing, setEditing] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  /** What the last action did, said under the buttons ("Signed out of 2 browsers"). */
  const [done, setDone] = useState('');
  const { overview } = useAdmin();
  const { lang } = useI18n();
  /** Without an email server nothing is emailed: no link, and the notices (restored, suspended) don't go. */
  const canMail = overview ? overview.mail.configured : true;
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

  async function run(action: () => Promise<unknown>, said?: (result: never) => string) {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const result = await action();
      if (said) setDone(said(result as never));
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

          {/* A new address waiting for its link: the address changes when it's opened. */}
          {data.pendingEmail && (
            <div className="adm-callout is-info">
              <AtSign size={18} aria-hidden="true" />
              <div>
                <strong>{t('users.pendingEmail', { email: data.pendingEmail.email })}</strong>
                <p>
                  {t('users.pendingEmailBody', { sent: timeAgo(data.pendingEmail.sentAt), until: formatDateTime(data.pendingEmail.expiresAt) })}
                </p>
                {editable && (
                  <div className="adm-user-buttons">
                    {canMail && (
                      <button
                        type="button"
                        className="adm-btn is-small"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => api(`/admin/users/${u!.id}/email/resend`, { method: 'POST', body: { lang } }),
                            () => t('users.emailChangeSent', { email: data.pendingEmail!.email }),
                          )
                        }
                      >
                        <Send size={14} /> {t('users.resendLink')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="adm-btn is-small is-ghost"
                      disabled={busy}
                      onClick={() => void run(() => api(`/admin/users/${u!.id}/email/pending`, { method: 'DELETE' }), () => t('users.emailChangeCancelled'))}
                    >
                      <X size={14} /> {t('users.cancelEmailChange')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

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
              <dt>{t('users.followers')}</dt>
              <dd>{formatNumber(u!.followers)}</dd>
            </div>
            <div>
              <dt>{t('users.following')}</dt>
              <dd>{formatNumber(u!.following)}</dd>
            </div>
            <div>
              <dt>{t('users.failedSignIns')}</dt>
              <dd>{u!.failedSignIns > 0 ? <Badge tone="bad">{formatNumber(u!.failedSignIns)}</Badge> : '0'}</dd>
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
                {/* (only with an email server: these go by email) */}
                {!u!.emailVerified && canMail && (
                  <button
                    type="button"
                    className="adm-btn is-small"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => api(`/admin/users/${u!.id}/verification`, { method: 'POST', body: { lang } }),
                        () => t('users.verificationSent', { email: u!.email }),
                      )
                    }
                  >
                    <MailPlus size={14} /> {t('users.resendVerification')}
                  </button>
                )}
                {canMail && (
                  <button type="button" className="adm-btn is-small" disabled={busy} onClick={() => setChangingEmail(true)}>
                    <AtSign size={14} /> {t('users.changeEmail')}
                  </button>
                )}
                <button type="button" className="adm-btn is-small" onClick={() => setEditing(true)}>
                  <UserPen size={14} /> {t('profile.edit')}
                </button>
                <button type="button" className="adm-btn is-small" disabled={busy || u!.sessions === 0} onClick={() => setConfirm('sessions')}>
                  <LogOut size={14} /> {t('users.endSessions')}
                </button>
                {/* (only with an email server: the link goes by email) */}
                {canMail && (
                  <button type="button" className="adm-btn is-small" disabled={busy} onClick={() => setConfirm('reset')}>
                    <KeyRound size={14} /> {t('users.sendReset')}
                  </button>
                )}
                {!u!.suspension && (
                  <button type="button" className="adm-btn is-small is-danger-ghost" onClick={() => setSuspending(true)}>
                    <Ban size={14} /> {t('users.suspend')}
                  </button>
                )}
              </div>
              {done && (
                <p className="adm-saved" role="status">
                  {done}
                </p>
              )}
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

          {data.changes.length > 0 && (
            <section className="adm-user-section">
              <h3>{t('users.changes')}</h3>
              <ul className="adm-feed is-compact">
                {data.changes.map((change, i) => (
                  <li key={`${change.field}-${change.at}-${i}`}>
                    <History size={15} className="adm-muted" aria-hidden="true" />
                    <div>
                      <p className="adm-break">
                        {t(`users.change.${change.field}` as AdminKey)}: <span className="adm-muted">{change.from ?? '—'}</span> → <strong>{change.to ?? '—'}</strong>
                      </p>
                      <span className="adm-muted adm-small">
                        {formatDateTime(change.at)} · {t(`users.change.via.${change.via}` as AdminKey)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.logins.length > 0 && (
            <section className="adm-user-section">
              <h3>{t('users.logins')}</h3>
              <ul className="adm-feed is-compact">
                {data.logins.map((login) => {
                  const status = login.endedAt
                    ? {
                        tone: 'neutral' as const,
                        label: t('users.login.ended', { reason: t(`users.login.reason.${login.endReason ?? 'signed_out'}` as AdminKey), date: formatDateTime(login.endedAt) }),
                      }
                    : new Date(login.expiresAt) <= new Date()
                      ? { tone: 'neutral' as const, label: t('users.login.expired', { date: formatDateTime(login.expiresAt) }) }
                      : { tone: 'good' as const, label: t('users.login.active', { date: formatDateTime(login.expiresAt) }) };
                  return (
                    <li key={login.startedAt}>
                      <LogIn size={15} className="adm-muted" aria-hidden="true" />
                      <div>
                        <p>
                          {t('users.login.started', { date: formatDateTime(login.startedAt) })} <Badge tone={status.tone}>{status.label}</Badge>
                        </p>
                        {login.device && <span className="adm-muted adm-small">{login.device}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {data.attempts.length > 0 && (
            <section className="adm-user-section">
              <h3>
                {t('users.attempts')}
                <Link to={`/admin/jurnal?tab=auth&user=${u!.id}`} className="adm-link">
                  {t('common.all')} <ChevronRight size={14} />
                </Link>
              </h3>
              <ul className="adm-feed is-compact">
                {data.attempts.map((attempt, i) => (
                  <li key={`${attempt.at}-${i}`}>
                    {attempt.outcome === 'ok' ? (
                      <KeyRound size={15} className="adm-muted" aria-hidden="true" />
                    ) : (
                      <ShieldX size={15} className="adm-bad" aria-hidden="true" />
                    )}
                    <div>
                      <p>
                        {t(`auth.method.${attempt.method}` as AdminKey)}{' '}
                        <Badge tone={attempt.outcome === 'ok' ? 'good' : 'bad'}>{t(`auth.outcome.${attempt.outcome}` as AdminKey)}</Badge>
                      </p>
                      <span className="adm-muted adm-small">
                        {formatDateTime(attempt.at)}
                        {attempt.device && <> · {attempt.device}</>}
                        {attempt.email && attempt.email !== u!.email && <> · {attempt.email}</>}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.devices.length > 0 && (
            <section className="adm-user-section">
              <h3>
                {t('users.devices')}
                <Link to={`/admin/jurnal?tab=push&user=${u!.id}`} className="adm-link">
                  {t('logs.tab.push')} <ChevronRight size={14} />
                </Link>
              </h3>
              <ul className="adm-feed is-compact">
                {data.devices.map((device) => (
                  <li key={device.id}>
                    <BellRing size={15} className="adm-muted" aria-hidden="true" />
                    <div>
                      <p>
                        {device.device ?? t('users.device.unknown')}{' '}
                        {device.activity ? <Badge tone="good">{t('users.device.on')}</Badge> : <Badge>{t('users.device.off')}</Badge>}
                        {device.books > 0 && <Badge tone="info">{t('users.device.books', { n: device.books })}</Badge>}
                      </p>
                      <span className="adm-muted adm-small">
                        {t('users.device.since', { date: formatDate(device.since) })}
                        {device.lastSentAt && <> · {t('users.device.last', { date: formatDateTime(device.lastSentAt) })}</>}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.links.length > 0 && (
            <section className="adm-user-section">
              <h3>{t('users.links')}</h3>
              <ul className="adm-feed is-compact">
                {data.links.map((link) => {
                  const status = link.usedAt
                    ? { tone: 'good' as const, label: t('users.link.used', { date: formatDateTime(link.usedAt) }) }
                    : link.revokedAt
                      ? { tone: 'neutral' as const, label: t(`users.link.revoked.${link.revokedReason ?? 'other'}` as AdminKey) }
                      : new Date(link.expiresAt) <= new Date()
                        ? { tone: 'neutral' as const, label: t('users.link.expired') }
                        : { tone: 'info' as const, label: t('users.link.open', { date: formatDateTime(link.expiresAt) }) };
                  return (
                    <li key={`${link.purpose}-${link.sentAt}`}>
                      <Mail size={15} className="adm-muted" aria-hidden="true" />
                      <div>
                        <p>
                          {t(`users.link.${link.purpose}` as AdminKey)} <Badge tone={status.tone}>{status.label}</Badge>
                        </p>
                        <span className="adm-muted adm-small">
                          {t('users.link.sent', { date: formatDateTime(link.sentAt) })}
                          {link.email !== u!.email && <> · {t('users.link.to', { email: link.email })}</>}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

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
            <Link to={`/admin/articole?author=${u!.id}`} className="adm-link">
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
          title={t(CONFIRM[confirm].title)}
          body={
            confirm === 'restore'
              ? `${t('users.restoreBody', { name: u.name })} ${canMail ? t('users.restoreMail', { email: u.email }) : t('users.noticeNoMail')}`
              : t(CONFIRM[confirm].body, { name: u.name, email: u.email })
          }
          confirmLabel={t(CONFIRM[confirm].title)}
          busy={busy}
          error={error}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            void (confirm === 'sessions'
              ? run(
                  () => api<{ ended: number }>(`/admin/users/${u.id}/sessions/end`, { method: 'POST' }),
                  (result: { ended: number }) => t('users.sessionsEnded', { n: result.ended }),
                )
              : confirm === 'reset'
                ? run(
                    () => api(`/admin/users/${u.id}/password-reset`, { method: 'POST', body: { lang } }),
                    () => t('users.resetSent', { email: u.email }),
                  )
                : run(() => api(confirm === 'lift' ? `/admin/users/${u.id}/suspend` : `/admin/users/${u.id}/restore`, { method: confirm === 'lift' ? 'DELETE' : 'POST' })))
          }
        />
      )}
      {changingEmail && u && (
        <EmailDialog
          user={u}
          onClose={() => setChangingEmail(false)}
          onSent={(email) => {
            setChangingEmail(false);
            setDone(t('users.emailChangeSent', { email }));
            load();
            onChanged();
          }}
        />
      )}
      {editing && u && (
        <ProfileDialog
          user={u}
          onClose={() => setEditing(false)}
          onSaved={(changed) => {
            setEditing(false);
            setDone(changed.length ? t('profile.saved') : t('profile.unchanged'));
            load();
            onChanged();
          }}
        />
      )}
    </Dialog>
  );
}

/**
 * Corrects what a person shows the others: name, username, occupation, quote, and their picture (taken off). What
 * changes is in the account's history and the administrators' log.
 */
function ProfileDialog({ user, onClose, onSaved }: { user: AdminUserDetail; onClose: () => void; onSaved: (changed: string[]) => void }) {
  const { t, errorMessage } = useAdminI18n();
  const [form, setForm] = useState({ name: user.name, username: user.username ?? '', occupation: user.occupation ?? '', quote: user.quote ?? '', removePicture: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  async function save() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ changed: string[] }>(`/admin/users/${user.id}/profile`, {
        method: 'PATCH',
        body: { name: form.name, ...(form.username ? { username: form.username } : {}), occupation: form.occupation, quote: form.quote, removePicture: form.removePicture },
      });
      onSaved(result.changed);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'name_invalid' ? t('profile.nameInvalid') : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('profile.title', { name: user.name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="adm-btn is-ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="adm-btn is-primary" onClick={() => void save()} disabled={busy}>
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <div className="adm-form">
        <p className="adm-muted adm-small">{t('profile.intro')}</p>
        <Field label={t('profile.field.name')}>
          <input className="adm-input" value={form.name} maxLength={80} onChange={(event) => set({ name: event.target.value })} />
        </Field>
        <Field label={t('profile.field.username')} hint={t('profile.usernameHint')}>
          <input className="adm-input" value={form.username} maxLength={40} onChange={(event) => set({ username: event.target.value })} />
        </Field>
        <Field label={t('profile.field.occupation')}>
          <input className="adm-input" value={form.occupation} maxLength={80} onChange={(event) => set({ occupation: event.target.value })} />
        </Field>
        <Field label={t('profile.field.quote')}>
          <textarea className="adm-input adm-textarea" rows={3} value={form.quote} maxLength={300} onChange={(event) => set({ quote: event.target.value })} />
        </Field>
        {user.picture && (
          <label className="adm-check">
            <input type="checkbox" checked={form.removePicture} onChange={(event) => set({ removePicture: event.target.checked })} />
            <Avatar name={user.name} picture={user.picture} size={28} />
            <span>{t('profile.removePicture')}</span>
          </label>
        )}
        {error && <p className="adm-form-error">{error}</p>}
      </div>
    </Dialog>
  );
}

/**
 * A new address for the account: a link goes to it, and the address changes when the person opens it (24 hours),
 * as when they change it themselves; until then the old one stays. Google sign-in stops with the change.
 */
function EmailDialog({ user, onClose, onSent }: { user: AdminUserDetail; onClose: () => void; onSent: (email: string) => void }) {
  const { t, lang, errorMessage } = useAdminI18n();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fresh = email.trim().toLowerCase();

  async function send() {
    if (fresh === user.email) return setError(t('users.emailSame'));
    setBusy(true);
    setError('');
    try {
      await api(`/admin/users/${user.id}/email`, { method: 'POST', body: { email: fresh, lang } });
      onSent(fresh);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('users.changeEmailTitle', { name: user.name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="adm-btn is-ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="adm-btn is-primary" onClick={() => void send()} disabled={busy || !/^\S+@\S+\.\S+$/.test(fresh)}>
            <Send size={15} /> {busy ? t('common.loading') : t('users.changeEmailSubmit')}
          </button>
        </>
      }
    >
      <div className="adm-form">
        <p className="adm-muted adm-small">{t('users.changeEmailIntro', { email: user.email })}</p>
        <Field label={t('users.newEmail')}>
          <input className="adm-input" type="email" maxLength={255} value={email} autoFocus onChange={(event) => setEmail(event.target.value)} />
        </Field>
        {user.google && (
          <p className="adm-callout is-warn adm-small">
            <TriangleAlert size={16} aria-hidden="true" /> {t(user.hasPassword ? 'users.changeEmailGoogle' : 'users.changeEmailGoogleOnly')}
          </p>
        )}
        {error && <p className="adm-form-error">{error}</p>}
      </div>
    </Dialog>
  );
}
