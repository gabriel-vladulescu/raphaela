import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ChevronRight, Clock, Construction, Eye, FileText, Flag, LifeBuoy, MailPlus, MailWarning, MessageSquare, PenLine, Trash2, UserPlus, UserX, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { FinalizeDialog } from '@/admin/FinalizeDialog';
import { TrafficChart } from '@/admin/charts';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminComment, AdminUser, Stats, TicketSummary } from '@/admin/types';
import { Badge, Card, Delta, Empty, Kpi, Loading, PageHead, roleKey } from '@/admin/ui';
import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { newArticlePath } from '@/lib/paths';

interface Todo {
  key: string;
  icon: LucideIcon;
  tone: 'bad' | 'warn' | 'info';
  label: string;
  to: string;
}

/** The overview: this month's numbers, traffic, what needs attention, and what happened lately. */
export function DashboardPage() {
  const { t, formatNumber, formatDate, timeAgo } = useAdminI18n();
  const { user } = useAuth();
  const { overview, refreshOverview } = useAdmin();
  const [stats, setStats] = useState<Stats | null>(null);
  const [due, setDue] = useState<AdminUser[]>([]);
  const [finalizing, setFinalizing] = useState<AdminUser | null>(null);
  const [comments, setComments] = useState<AdminComment[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);

  useEffect(() => {
    api<Stats>('/stats?days=30').then(setStats).catch(() => setStats(null));
    api<{ comments: AdminComment[] }>('/admin/comments?limit=5').then((d) => setComments(d.comments)).catch(() => setComments([]));
    api<{ users: AdminUser[] }>('/admin/users?limit=5&sort=new').then((d) => setUsers(d.users)).catch(() => setUsers([]));
    api<{ tickets: TicketSummary[] }>('/admin/support?limit=4').then((d) => setTickets(d.tickets)).catch(() => setTickets([]));
  }, []);

  // Deleted accounts whose 3 months are up: they wait for an administrator, with what their person chose.
  const dueCount = overview?.users.deletionDue ?? 0;
  useEffect(() => {
    if (!dueCount) return setDue([]);
    api<{ users: AdminUser[] }>('/admin/users?status=due&limit=10&sort=new')
      .then((d) => setDue(d.users))
      .catch(() => setDue([]));
  }, [dueCount]);

  const todos: Todo[] = overview
    ? [
        ...(overview.maintenance
          ? [{ key: 'maintenance', icon: Construction, tone: 'warn' as const, label: t('todo.maintenance'), to: '/admin/setari' }]
          : []),
        ...(overview.users.deletionDue
          ? [{ key: 'due', icon: Trash2, tone: 'bad' as const, label: t('todo.due', { n: overview.users.deletionDue }), to: '/admin/utilizatori?status=due' }]
          : []),
        ...(overview.reports.open ? [{ key: 'reports', icon: Flag, tone: 'bad' as const, label: t('todo.reports', { n: overview.reports.open }), to: '/admin/comentarii?filter=reported' }] : []),
        ...(overview.held ? [{ key: 'held', icon: Clock, tone: 'warn' as const, label: t('todo.held', { n: overview.held }), to: '/admin/comentarii?filter=held' }] : []),
        ...(overview.tickets.unseen ? [{ key: 'tickets', icon: LifeBuoy, tone: 'warn' as const, label: t('todo.tickets', { n: overview.tickets.unseen }), to: '/admin/suport' }] : []),
        ...(overview.mail.production && !overview.mail.configured
          ? [{ key: 'mail', icon: MailWarning, tone: 'bad' as const, label: t('todo.mail'), to: '/admin/setari' }]
          : !overview.mail.configured
            ? [{ key: 'mail', icon: MailWarning, tone: 'info' as const, label: t('todo.mailDev'), to: '/admin/setari' }]
            : []),
        ...(overview.users.deletedPending - overview.users.deletionDue > 0
          ? [
              {
                key: 'deleted',
                icon: UserX,
                tone: 'info' as const,
                label: t('todo.deleted', { n: overview.users.deletedPending - overview.users.deletionDue }),
                to: '/admin/utilizatori?status=deleted',
              },
            ]
          : []),
        ...(overview.users.suspended
          ? [{ key: 'suspended', icon: AlertTriangle, tone: 'info' as const, label: t('todo.suspended', { n: overview.users.suspended }), to: '/admin/utilizatori?status=suspended' }]
          : []),
        ...(overview.mail.failed24h
          ? [{ key: 'mailFailed', icon: MailWarning, tone: 'warn' as const, label: t('todo.mailFailed', { n: overview.mail.failed24h }), to: '/admin/setari?tab=history&status=failed' }]
          : []),
        ...(overview.mail.dailyLimit > 0 && overview.mail.sentToday >= overview.mail.dailyLimit * 0.8
          ? [
              {
                key: 'mailLimit',
                icon: MailWarning,
                tone: (overview.mail.sentToday >= overview.mail.dailyLimit ? 'bad' : 'warn') as 'bad' | 'warn',
                label: t('todo.mailLimit', { n: overview.mail.sentToday, limit: overview.mail.dailyLimit }),
                to: '/admin/setari?tab=history',
              },
            ]
          : []),
        ...(overview.posts.drafts ? [{ key: 'drafts', icon: PenLine, tone: 'info' as const, label: t('todo.drafts', { n: overview.posts.drafts }), to: '/admin/articole?status=draft' }] : []),
        ...(overview.invites.pending
          ? [{ key: 'invites', icon: MailPlus, tone: 'info' as const, label: t('todo.invites', { n: overview.invites.pending }), to: '/admin/utilizatori' }]
          : []),
      ]
    : [];

  const totals = stats?.totals;
  const before = stats?.previous;

  return (
    <>
      <PageHead
        title={t('dashboard.title', { name: user!.name.split(' ')[0]! })}
        subtitle={t('dashboard.subtitle')}
        actions={
          <Link to={newArticlePath(user!.username)} className="adm-btn is-primary">
            <PenLine size={16} /> {t('posts.new')}
          </Link>
        }
      />

      {due.length > 0 && (
        <section className="adm-card adm-due" aria-labelledby="due-title">
          <header className="adm-card-head">
            <h2 id="due-title">
              <Trash2 size={17} aria-hidden="true" /> {t('due.title', { n: dueCount })}
            </h2>
            <Link to="/admin/utilizatori?status=due" className="adm-link">
              {t('common.all')} <ChevronRight size={14} />
            </Link>
          </header>
          <p className="adm-muted adm-small">{t('due.body')}</p>
          <ul className="adm-due-list">
            {due.map((u) => (
              <li key={u.id}>
                <Avatar name={u.name} picture={u.picture} size={32} />
                <div className="adm-due-who">
                  <Link to={`/admin/utilizatori?status=due&id=${u.id}`}>
                    <strong>{u.name}</strong>
                  </Link>
                  <span className="adm-muted adm-small">
                    {u.email} · {t('due.deletedOn', { date: formatDate(u.deletedAt!) })}
                  </span>
                </div>
                <div className="adm-due-choices">
                  <Badge tone={u.deletion?.comments === 'delete' ? 'bad' : 'neutral'}>
                    {t(u.deletion?.comments === 'delete' ? 'due.commentsDelete' : 'due.commentsKeep')}
                  </Badge>
                  {(u.deletion?.postsTotal ?? 0) > 0 && (
                    <Badge tone={u.deletion?.posts === 'delete' ? 'bad' : 'neutral'}>
                      {t(u.deletion?.posts === 'delete' ? 'due.postsDelete' : 'due.postsKeep', { n: u.deletion!.postsTotal })}
                    </Badge>
                  )}
                </div>
                <button type="button" className="adm-btn is-small is-danger" onClick={() => setFinalizing(u)}>
                  {t('finalize.submit')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="adm-kpis">
        <Kpi
          icon={Eye}
          label={t('dashboard.views30')}
          value={totals ? formatNumber(totals.pageViews) : '—'}
          delta={totals && before && <Delta now={totals.pageViews} before={before.pageViews} />}
          spark={stats?.daily.map((d) => d.views)}
        />
        <Kpi
          icon={Users}
          label={t('dashboard.visitors30')}
          value={totals ? formatNumber(totals.visitors) : '—'}
          delta={totals && before && <Delta now={totals.visitors} before={before.visitors} />}
          spark={stats?.daily.map((d) => d.visitors)}
        />
        <Kpi
          icon={MessageSquare}
          label={t('dashboard.comments30')}
          value={totals ? formatNumber(totals.comments + totals.replies) : '—'}
          delta={totals && before && <Delta now={totals.comments + totals.replies} before={before.comments + before.replies} />}
          note={overview ? t('dashboard.commentsTotal', { n: formatNumber(overview.comments.total) }) : undefined}
        />
        <Kpi
          icon={UserPlus}
          label={t('dashboard.accounts')}
          value={overview ? formatNumber(overview.users.total) : '—'}
          note={overview ? t('dashboard.accountsWeek', { n: overview.users.week }) : undefined}
        />
      </div>

      <div className="adm-grid is-2-1">
        <Card
          title={t('dashboard.traffic')}
          actions={
            <Link to="/admin/statistici" className="adm-link">
              {t('dashboard.allStats')} <ChevronRight size={14} />
            </Link>
          }
        >
          {stats ? <TrafficChart days={stats.daily} /> : <Loading />}
        </Card>
        <Card title={t('dashboard.todo')}>
          {!overview ? (
            <Loading />
          ) : todos.length === 0 ? (
            <Empty icon={Flag} title={t('dashboard.todoNone')} body={t('dashboard.todoNoneBody')} />
          ) : (
            <ul className="adm-todos">
              {todos.map((todo) => (
                <li key={todo.key}>
                  <Link to={todo.to} className={`adm-todo is-${todo.tone}`}>
                    <todo.icon size={17} aria-hidden="true" />
                    <span>{todo.label}</span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {overview && (
            <dl className="adm-facts">
              <div>
                <dt>{t('dashboard.published')}</dt>
                <dd>{formatNumber(overview.posts.published)}</dd>
              </div>
              <div>
                <dt>{t('dashboard.scheduled')}</dt>
                <dd>{formatNumber(overview.posts.scheduled)}</dd>
              </div>
              <div>
                <dt>{t('dashboard.authors')}</dt>
                <dd>{formatNumber(overview.users.authors)}</dd>
              </div>
              <div>
                <dt>{t('dashboard.categories')}</dt>
                <dd>{formatNumber(overview.categories.total)}</dd>
              </div>
            </dl>
          )}
        </Card>
      </div>

      <div className="adm-grid is-3">
        <Card
          title={t('dashboard.recentComments')}
          flush
          actions={
            <Link to="/admin/comentarii" className="adm-link">
              {t('common.all')} <ChevronRight size={14} />
            </Link>
          }
        >
          {comments === null ? (
            <Loading />
          ) : comments.length === 0 ? (
            <Empty icon={MessageSquare} title={t('comments.none')} />
          ) : (
            <ul className="adm-feed">
              {comments.map((c) => (
                <li key={c.id}>
                  <Avatar name={c.author.deleted ? '?' : c.author.name} picture={c.author.picture} size={30} />
                  <div>
                    <p className="adm-feed-line">
                      <strong>{c.author.deleted ? t('users.deletedAccount') : c.author.name}</strong>{' '}
                      <span className="adm-muted">
                        {t('dashboard.on')} <Link to={`/posts/${c.post.slug}`}>{c.post.title}</Link>
                      </span>
                    </p>
                    <p className="adm-clamp">{c.body}</p>
                    <span className="adm-muted adm-small">
                      {timeAgo(c.createdAt)}
                      {c.deletedAt && (
                        <>
                          {' '}
                          · <Badge tone="bad">{t('comments.deleted')}</Badge>
                        </>
                      )}
                      {c.reports.length > 0 && (
                        <>
                          {' '}
                          · <Badge tone="warn">{t('comments.reportsN', { n: c.reports.length })}</Badge>
                        </>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={t('dashboard.newUsers')}
          flush
          actions={
            <Link to="/admin/utilizatori" className="adm-link">
              {t('common.all')} <ChevronRight size={14} />
            </Link>
          }
        >
          {users === null ? (
            <Loading />
          ) : users.length === 0 ? (
            <Empty icon={Users} title={t('users.none')} />
          ) : (
            <ul className="adm-feed">
              {users.map((u) => (
                <li key={u.id}>
                  <Avatar name={u.name} picture={u.picture} size={30} />
                  <div>
                    <p className="adm-feed-line">
                      <Link to={`/admin/utilizatori?id=${u.id}`}>
                        <strong>{u.name}</strong>
                      </Link>{' '}
                      <Badge tone={u.role === 'member' ? 'neutral' : 'accent'}>{t(roleKey(u.role))}</Badge>
                    </p>
                    <span className="adm-muted adm-small">
                      {u.email} · {timeAgo(u.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={t('dashboard.topPosts')}
          flush
          actions={
            <Link to="/admin/articole?sort=views" className="adm-link">
              {t('common.all')} <ChevronRight size={14} />
            </Link>
          }
        >
          {stats === null ? (
            <Loading />
          ) : stats.posts.length === 0 ? (
            <Empty icon={FileText} title={t('stats.noPosts')} />
          ) : (
            <ol className="adm-rank">
              {stats.posts.slice(0, 5).map((p, i) => (
                <li key={p.id}>
                  <span className="adm-rank-n">{i + 1}</span>
                  <Link to={`/posts/${p.slug}`} className="adm-rank-title">
                    {p.title}
                  </Link>
                  <span className="adm-rank-value">
                    <Eye size={13} aria-hidden="true" /> {formatNumber(p.views)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {tickets && tickets.length > 0 && (
        <Card
          title={t('dashboard.latestTickets')}
          flush
          actions={
            <Link to="/admin/suport" className="adm-link">
              {t('common.all')} <ChevronRight size={14} />
            </Link>
          }
        >
          <ul className="adm-feed is-tickets">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <LifeBuoy size={18} className="adm-muted" aria-hidden="true" />
                <div>
                  <p className="adm-feed-line">
                    <Link to={`/admin/suport/${ticket.id}`}>
                      <strong>{ticket.title}</strong>
                    </Link>{' '}
                    {!ticket.seen && <Badge tone="accent">{t('support.new')}</Badge>}
                  </p>
                  <span className="adm-muted adm-small">
                    {ticket.name ?? ticket.email} · {timeAgo(ticket.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {finalizing && (
        <FinalizeDialog
          user={finalizing}
          onClose={() => setFinalizing(null)}
          onDone={() => {
            setFinalizing(null);
            refreshOverview();
          }}
        />
      )}
    </>
  );
}
