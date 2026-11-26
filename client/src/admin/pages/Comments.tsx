import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Ban, Check, Clock, CornerDownRight, ExternalLink, Flag, History, MessageSquare, Trash2, X } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import { SuspendDialog } from '@/admin/SuspendDialog';
import type { AdminComment, CommentFilter, CommentList } from '@/admin/types';
import { UserSelect } from '@/admin/UserSelect';
import { Badge, Card, ConfirmDialog, Dialog, Empty, ErrorNote, LoadMore, Loading, PageHead, SearchBox, Tabs } from '@/admin/ui';
import { Avatar } from '@/components/Avatar';
import { api } from '@/lib/api';

const PAGE = 20;
const FILTERS: CommentFilter[] = ['held', 'reported', 'all', 'deleted'];

/**
 * Moderation: comments waiting for approval (the comment filters, Settings), reported comments (why, by whom), then
 * every comment, and the deleted ones. Approve or reject a held one, keep a reported one, delete one (with its
 * replies), or suspend whoever wrote it.
 */
export function CommentsPage() {
  const { t, timeAgo, formatDateTime } = useAdminI18n();
  const { overview, refreshOverview } = useAdmin();
  const [params, setParams] = useSearchParams();
  const asked = FILTERS.find((f) => f === params.get('filter'));
  const filter: CommentFilter = asked ?? (overview?.held ? 'held' : overview?.reports.open ? 'reported' : 'all');
  const q = params.get('q') ?? '';
  const userId = params.get('user') ?? '';
  const [data, setData] = useState<CommentList | null>(null);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);
  const [deleting, setDeleting] = useState<AdminComment | null>(null);
  const [suspending, setSuspending] = useState<AdminComment['author'] | null>(null);
  /** The comment whose earlier versions are open. */
  const [versionsOf, setVersionsOf] = useState<AdminComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const query = useCallback(
    (offset: number) => `/admin/comments?filter=${filter}&offset=${offset}&limit=${PAGE}${q ? `&q=${encodeURIComponent(q)}` : ''}${userId ? `&user=${userId}` : ''}`,
    [filter, q, userId],
  );
  const load = useCallback(() => {
    setError(false);
    api<CommentList>(query(0))
      .then(setData)
      .catch(() => setError(true));
  }, [query]);
  useEffect(load, [load]);

  async function loadMore() {
    if (!data) return;
    setMore(true);
    try {
      const next = await api<CommentList>(query(data.comments.length));
      setData({ ...next, comments: [...data.comments, ...next.comments.filter((c) => !data.comments.some((o) => o.id === c.id))] });
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

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError('');
    try {
      await action();
      setDeleting(null);
      load();
      refreshOverview();
    } catch {
      setActionError(t('common.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title={t('nav.comments')} subtitle={t('comments.subtitle')} />
      <Card flush>
        <div className="adm-toolbar">
          <Tabs<CommentFilter>
            label={t('comments.filter')}
            value={filter}
            onChange={(value) => set('filter', value)}
            items={FILTERS.map((value) => ({ value, label: t(`comments.filter.${value}` as AdminKey), count: data?.counts[value] }))}
          />
          <div className="adm-toolbar-row">
            <SearchBox value={q} onChange={(value) => set('q', value)} placeholder={t('comments.search')} />
            <UserSelect
              label={t('comments.byWhom')}
              placeholder={t('comments.everyone')}
              clear={t('comments.everyone')}
              value={userId ? Number(userId) : null}
              onChange={(id) => set('user', id ? String(id) : '')}
            />
          </div>
        </div>
        {actionError && <p className="adm-form-error adm-pad">{actionError}</p>}

        {error ? (
          <ErrorNote message={t('common.loadFailed')} onRetry={load} />
        ) : !data ? (
          <Loading />
        ) : data.comments.length === 0 ? (
          <div className="adm-pad">
            <Empty
              icon={filter === 'reported' ? Flag : filter === 'held' ? Clock : MessageSquare}
              title={filter === 'reported' ? t('comments.noReports') : filter === 'held' ? t('comments.noHeld') : t('comments.none')}
              body={filter === 'reported' ? t('comments.noReportsBody') : filter === 'held' ? t('comments.noHeldBody') : undefined}
            />
          </div>
        ) : (
          <ul className="adm-comments">
            {data.comments.map((c) => (
              <li key={c.id} data-comment={c.id} className={`adm-comment${c.deletedAt ? ' is-deleted' : ''}${c.reports.length ? ' is-reported' : ''}${c.held && !c.deletedAt ? ' is-held' : ''}`}>
                <Avatar name={c.author.deleted ? '?' : c.author.name} picture={c.author.picture} size={34} />
                <div className="adm-comment-main">
                  <div className="adm-comment-meta">
                    {c.author.deleted ? (
                      <strong>{t('users.deletedAccount')}</strong>
                    ) : (
                      <Link to={`/admin/utilizatori?id=${c.author.id}`}>
                        <strong>{c.author.name}</strong>
                      </Link>
                    )}
                    {c.author.role !== 'member' && <Badge tone="accent">{t(`role.${c.author.role}` as AdminKey)}</Badge>}
                    {c.author.suspended && <Badge tone="bad">{t('users.state.suspended')}</Badge>}
                    <span className="adm-muted adm-small" title={formatDateTime(c.createdAt)}>
                      {timeAgo(c.createdAt)}
                    </span>
                    {c.editedAt && (
                      <button type="button" className="adm-chip is-small" title={t('comments.versions')} onClick={() => setVersionsOf(c)}>
                        <History size={12} aria-hidden="true" /> {t('comments.edited')}
                      </button>
                    )}
                    {c.held && !c.deletedAt && (
                      <Badge tone="warn" title={t(`comments.heldWhy.${c.held}` as AdminKey)}>
                        <Clock size={12} aria-hidden="true" /> {t('comments.held')}
                      </Badge>
                    )}
                    {c.deletedAt && (
                      <Badge tone="bad" title={c.deletedBy ? t('comments.deletedBy', { name: c.deletedBy }) : undefined}>
                        {t('comments.deleted')}
                      </Badge>
                    )}
                  </div>
                  <p className="adm-comment-post adm-small">
                    {c.isReply && <CornerDownRight size={13} aria-label={t('comments.reply')} />}
                    <span className="adm-muted">{t('dashboard.on')}</span> <Link to={`/posts/${c.post.slug}`}>{c.post.title}</Link>
                    {c.replies > 0 && <span className="adm-muted"> · {t('comments.repliesN', { n: c.replies })}</span>}
                  </p>
                  <p className="adm-comment-body">{c.body}</p>
                  {c.held && !c.deletedAt && <p className="adm-held-why adm-small">{t(`comments.heldWhy.${c.held}` as AdminKey)}</p>}

                  {c.reports.length > 0 && (
                    <div className="adm-reports">
                      <strong className="adm-reports-title">
                        <Flag size={14} aria-hidden="true" /> {t('comments.reportsN', { n: c.reports.length })}
                      </strong>
                      <ul>
                        {c.reports.map((r, i) => (
                          <li key={i}>
                            <Badge tone="warn">{t(`reason.${r.reason}` as AdminKey)}</Badge>
                            {r.details && <span className="adm-report-details">“{r.details}”</span>}
                            <span className="adm-muted adm-small">
                              {r.reporter ? r.reporter.name : t('users.deletedAccount')} · {timeAgo(r.createdAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="adm-comment-actions">
                    {c.held && !c.deletedAt && (
                      <>
                        <button type="button" className="adm-btn is-small is-primary" disabled={busy} onClick={() => void run(() => api(`/admin/comments/${c.id}/approve`, { method: 'POST' }))}>
                          <Check size={14} /> {t('comments.approve')}
                        </button>
                        <button type="button" className="adm-btn is-small is-danger-ghost" disabled={busy} onClick={() => void run(() => api(`/admin/comments/${c.id}/reject`, { method: 'POST' }))}>
                          <X size={14} /> {t('comments.reject')}
                        </button>
                      </>
                    )}
                    {c.reports.length > 0 && !c.deletedAt && (
                      <button type="button" className="adm-btn is-small" disabled={busy} onClick={() => void run(() => api(`/admin/comments/${c.id}/keep`, { method: 'POST' }))}>
                        <Check size={14} /> {t('comments.keep')}
                      </button>
                    )}
                    {!c.deletedAt && !c.held && (
                      <button type="button" className="adm-btn is-small is-danger-ghost" onClick={() => setDeleting(c)}>
                        <Trash2 size={14} /> {t('comments.delete')}
                      </button>
                    )}
                    {!c.author.deleted && !c.author.suspended && c.author.role !== 'owner' && (
                      <button type="button" className="adm-btn is-small is-ghost" onClick={() => setSuspending(c.author)}>
                        <Ban size={14} /> {t('comments.suspendAuthor')}
                      </button>
                    )}
                    <Link to={`/posts/${c.post.slug}#discussion-title`} className="adm-btn is-small is-ghost">
                      <ExternalLink size={14} /> {t('comments.open')}
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {data?.hasMore && <LoadMore busy={more} onClick={() => void loadMore()} />}
      </Card>

      {deleting && (
        <ConfirmDialog
          title={t('comments.delete')}
          body={
            <>
              <p>{deleting.replies > 0 ? t('comments.deleteBodyReplies', { n: deleting.replies }) : t('comments.deleteBody')}</p>
              <blockquote className="adm-quote">{deleting.body}</blockquote>
            </>
          }
          confirmLabel={t('comments.delete')}
          danger
          busy={busy}
          error={actionError}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void run(() => api(`/comments/${deleting.id}`, { method: 'DELETE' }))}
        />
      )}
      {versionsOf && <VersionsDialog comment={versionsOf} onClose={() => setVersionsOf(null)} />}
      {suspending && (
        <SuspendDialog
          user={suspending}
          onClose={() => setSuspending(null)}
          onDone={() => {
            setSuspending(null);
            load();
            refreshOverview();
          }}
        />
      )}
    </>
  );
}

/** A comment's versions, oldest first: each earlier text (kept when it was edited) and when it was replaced, then now. */
function VersionsDialog({ comment, onClose }: { comment: AdminComment; onClose: () => void }) {
  const { t, formatDateTime } = useAdminI18n();
  const [data, setData] = useState<{ createdAt: string; versions: { body: string; replacedAt: string }[]; current: { body: string; editedAt: string | null } } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<NonNullable<typeof data>>(`/admin/comments/${comment.id}/versions`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [comment.id]);
  return (
    <Dialog title={t('comments.versionsTitle', { name: comment.author.name })} onClose={onClose} wide>
      {failed ? (
        <ErrorNote message={t('common.loadFailed')} />
      ) : !data ? (
        <Loading />
      ) : (
        <ol className="adm-versions">
          {data.versions.map((version, i) => (
            <li key={`${version.replacedAt}-${i}`}>
              <span className="adm-edit-label">
                {t('comments.version', { n: i + 1 })} · {formatDateTime(i === 0 ? data.createdAt : data.versions[i - 1]!.replacedAt)} → {formatDateTime(version.replacedAt)}
              </span>
              <p className="adm-edit-text is-before">{version.body}</p>
            </li>
          ))}
          <li>
            <span className="adm-edit-label">
              {t('comments.versionNow')}
              {data.current.editedAt && <> · {formatDateTime(data.current.editedAt)}</>}
            </span>
            <p className="adm-edit-text">{data.current.body}</p>
          </li>
        </ol>
      )}
    </Dialog>
  );
}
