import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Archive, ArrowLeft, CircleCheck, FileText, LifeBuoy, MailWarning, MessageSquareReply, Paperclip, RotateCcw, Send, UserRound } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import type { Ticket, TicketStatus, TicketSummary } from '@/admin/types';
import { Badge, Card, ConfirmDialog, Empty, ErrorNote, LoadMore, Loading, PageHead, roleKey, Tabs } from '@/admin/ui';
import type { Tone } from '@/admin/ui';
import { Avatar } from '@/components/Avatar';
import { ApiError, api } from '@/lib/api';
import { refreshUnread } from '@/lib/unread';

const PAGE = 20;
const category = (value: string) => `support.cat.${value}` as AdminKey;
const STATUS_TONE: Record<TicketStatus, Tone> = { open: 'warn', answered: 'good', closed: 'neutral' };
const FILTERS = ['all', 'open', 'answered', 'closed'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Support tickets, the latest activity first, by state: open (waiting for an answer), answered, closed; the ones not
 * opened yet are marked. Each is a conversation, answered from its page.
 */
export function SupportPage() {
  const { t, timeAgo, formatDateTime } = useAdminI18n();
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS.find((value) => value === params.get('status')) ?? 'all') as Filter;
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [counts, setCounts] = useState<Record<Filter, number> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      const data = await api<{ tickets: TicketSummary[]; hasMore: boolean; counts: Record<Filter, number> }>(
        `/admin/support?offset=${offset}&limit=${PAGE}${filter !== 'all' ? `&status=${filter}` : ''}`,
      );
      setTickets((current) => (offset === 0 ? data.tickets : [...(current ?? []), ...data.tickets]));
      setHasMore(data.hasMore);
      setCounts(data.counts);
    },
    [filter],
  );

  useEffect(() => {
    setTickets(null);
    load(0).catch(() => setError(true));
  }, [load]);

  return (
    <>
      <PageHead title={t('nav.support')} subtitle={t('support.subtitle')} />
      <Card flush>
        <div className="adm-toolbar adm-toolbar-plain">
          <Tabs<Filter>
            label={t('support.status')}
            value={filter}
            onChange={(value) => setParams(value === 'all' ? {} : { status: value })}
            items={FILTERS.map((value) => ({ value, label: t(`support.filter.${value}` as AdminKey), count: counts?.[value] }))}
          />
        </div>
        {error ? (
          <ErrorNote message={t('common.loadFailed')} onRetry={() => void load(0).catch(() => setError(true))} />
        ) : !tickets ? (
          <Loading />
        ) : tickets.length === 0 ? (
          <div className="adm-pad">
            <Empty icon={LifeBuoy} title={t('support.none')} body={t('support.noneBody')} />
          </div>
        ) : (
          <ul className="adm-tickets">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <Link to={`/admin/suport/${ticket.id}`} className={`adm-ticket${ticket.seen ? '' : ' is-new'}`}>
                  <span className="adm-ticket-dot" aria-hidden="true" />
                  <div className="adm-ticket-main">
                    <div className="adm-ticket-top">
                      <strong>{ticket.title}</strong>
                      {!ticket.seen && <Badge tone="accent">{t('support.new')}</Badge>}
                      <Badge tone={STATUS_TONE[ticket.status]}>{t(`support.state.${ticket.status}` as AdminKey)}</Badge>
                      <Badge>{t(category(ticket.category))}</Badge>
                      {ticket.replies > 0 && (
                        <span className="adm-muted adm-small">
                          <MessageSquareReply size={13} aria-hidden="true" /> {ticket.replies}
                        </span>
                      )}
                      {ticket.account && (
                        <span className="adm-muted adm-small" title={t('support.withAccount')}>
                          <UserRound size={13} aria-label={t('support.withAccount')} />
                        </span>
                      )}
                      {ticket.files > 0 && (
                        <span className="adm-muted adm-small">
                          <Paperclip size={13} aria-hidden="true" /> {ticket.files}
                        </span>
                      )}
                    </div>
                    <p className="adm-muted adm-clamp">{ticket.preview}</p>
                  </div>
                  <div className="adm-ticket-side adm-small">
                    <span>{ticket.name ?? ticket.email}</span>
                    <time className="adm-muted" dateTime={ticket.updatedAt} title={formatDateTime(ticket.updatedAt)}>
                      {timeAgo(ticket.updatedAt)}
                    </time>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <LoadMore
            busy={more}
            onClick={() => {
              setMore(true);
              void load(tickets?.length ?? 0).finally(() => setMore(false));
            }}
          />
        )}
      </Card>
    </>
  );
}

/**
 * One ticket: who sent it (and their account), the conversation (what they wrote, the files, the answers), and the
 * answer box: it goes by email, and into their account when they sent it signed in. Without an SMTP server (in
 * development too) there's no answering (Settings → Email). Closed, or open again.
 */
export function TicketPage() {
  const { id = '' } = useParams();
  const { t, lang, formatDate, formatDateTime, errorMessage } = useAdminI18n();
  const { refreshOverview } = useAdmin();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [mail, setMail] = useState(true);
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState('');
  const [answerError, setAnswerError] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [restoring, setRestoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  // A deleted account whose person wrote that it was a mistake: restored from here.
  async function restore() {
    setBusy(true);
    setError('');
    try {
      await api(`/admin/users/${ticket!.account!.id}/restore`, { method: 'POST' });
      setRestoring(false);
      setReload((n) => n + 1);
      refreshOverview();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    api<{ ticket: Ticket; mail: boolean }>(`/admin/support/${encodeURIComponent(id)}`)
      .then((data) => {
        setTicket(data.ticket);
        setMail(data.mail);
        setStatus('ready');
        // Opening it marked it seen, and its notification read.
        refreshOverview();
        void refreshUnread();
      })
      .catch((err) => setStatus(err instanceof ApiError && err.status === 404 ? 'missing' : 'error'));
  }, [id, refreshOverview, reload]);

  const file = (fileId: number) => `/api/admin/support/${ticket?.id}/files/${fileId}`;

  async function reply(event: FormEvent) {
    event.preventDefault();
    if (!ticket || answer.trim().length < 2) return;
    setSending(true);
    setAnswerError('');
    setSent('');
    try {
      const data = await api<{ replies: Ticket['replies']; status: TicketStatus; emailed: boolean; inApp: boolean }>(`/admin/support/${ticket.id}/replies`, {
        method: 'POST',
        body: { body: answer.trim(), lang },
      });
      setTicket({ ...ticket, replies: data.replies, status: data.status });
      setAnswer('');
      setSent(t(data.emailed ? (data.inApp ? 'support.sentBoth' : 'support.sentEmail') : data.inApp ? 'support.sentAppOnly' : 'support.sentFailed'));
      refreshOverview();
    } catch (err) {
      setAnswerError(err instanceof ApiError && err.code === 'email_unavailable' ? t('support.noMail') : errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function changeStatus(status: 'open' | 'closed') {
    if (!ticket) return;
    setBusy(true);
    try {
      await api(`/admin/support/${ticket.id}/status`, { method: 'POST', body: { status } });
      setTicket({ ...ticket, status });
      refreshOverview();
    } catch (err) {
      setAnswerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const back = (
    <Link to="/admin/suport" className="adm-btn is-ghost">
      <ArrowLeft size={16} /> {t('support.back')}
    </Link>
  );

  if (status !== 'ready' || !ticket) {
    return (
      <>
        <PageHead title={t('nav.support')} actions={back} />
        {status === 'loading' ? <Loading /> : <ErrorNote message={t(status === 'missing' ? 'support.missing' : 'common.loadFailed')} />}
      </>
    );
  }

  return (
    <>
      <PageHead
        title={ticket.title}
        subtitle={
          <span className="adm-badges">
            <Badge tone={STATUS_TONE[ticket.status]}>{t(`support.state.${ticket.status}` as AdminKey)}</Badge>
            <Badge>{t(category(ticket.category))}</Badge>
          </span>
        }
        actions={
          <>
            {ticket.status === 'closed' ? (
              <button type="button" className="adm-btn" disabled={busy} onClick={() => void changeStatus('open')}>
                <RotateCcw size={16} /> {t('support.reopen')}
              </button>
            ) : (
              <button type="button" className="adm-btn" disabled={busy} onClick={() => void changeStatus('closed')}>
                <Archive size={16} /> {t('support.close')}
              </button>
            )}
            {back}
          </>
        }
      />
      <div className="adm-grid is-2-1">
        <Card title={t('support.conversation')}>
          <div className="adm-ticket-body">{ticket.body}</div>
          {ticket.files.length > 0 && (
            <>
              <h3 className="adm-subtitle">{t('support.files', { n: ticket.files.length })}</h3>
              <div className="adm-files">
                {ticket.files.map((f) =>
                  f.mime.startsWith('image/') ? (
                    <a key={f.id} href={file(f.id)} target="_blank" rel="noopener noreferrer" className="adm-file is-image">
                      <img src={file(f.id)} alt={f.name} loading="lazy" />
                      <span>{f.name}</span>
                    </a>
                  ) : (
                    <a key={f.id} href={file(f.id)} target="_blank" rel="noopener noreferrer" className="adm-file">
                      <FileText size={20} aria-hidden="true" />
                      <span>{f.name}</span>
                    </a>
                  ),
                )}
              </div>
            </>
          )}
          {ticket.replies.length > 0 && (
            <ol className="adm-thread">
              {ticket.replies.map((r) => (
                <li key={r.id} className={r.staff ? 'is-staff' : undefined}>
                  <Avatar name={r.author.name} picture={r.author.picture} size={28} />
                  <div>
                    <p className="adm-small">
                      <strong>{r.author.name}</strong> · {r.staff ? t('support.byAdmin') : t('support.bySender')} · <time dateTime={r.createdAt}>{formatDateTime(r.createdAt)}</time>
                      {r.staff && !r.emailed && (
                        <>
                          {' '}
                          <Badge tone="bad">{t('support.notEmailed')}</Badge>
                        </>
                      )}
                    </p>
                    <div className="adm-ticket-body">{r.body}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <form className="adm-form adm-answer" onSubmit={reply}>
            <h3 className="adm-subtitle">{t('support.answer')}</h3>
            {!mail ? (
              <div className="adm-callout is-bad">
                <MailWarning size={18} aria-hidden="true" />
                <div>
                  <strong>{t('support.noMailTitle')}</strong>
                  <p>
                    {t('support.noMail')}{' '}
                    <Link to="/admin/setari?tab=email" className="adm-link">
                      {t('support.setMail')}
                    </Link>
                  </p>
                </div>
              </div>
            ) : (
              <p className="adm-muted adm-small">{t(ticket.user ? 'support.answerBoth' : 'support.answerEmail', { email: ticket.email })}</p>
            )}
            <textarea
              className="adm-input adm-textarea"
              rows={6}
              maxLength={5000}
              value={answer}
              disabled={!mail || sending}
              placeholder={t('support.answerPlaceholder')}
              aria-label={t('support.answer')}
              onChange={(event) => setAnswer(event.target.value)}
            />
            {answerError && <p className="adm-form-error">{answerError}</p>}
            <div className="adm-form-actions">
              {sent && (
                <span className="adm-saved" role="status">
                  <CircleCheck size={15} /> {sent}
                </span>
              )}
              <button type="submit" className="adm-btn is-primary" disabled={!mail || sending || answer.trim().length < 2}>
                <Send size={15} /> {sending ? t('common.loading') : t('support.send')}
              </button>
            </div>
          </form>
        </Card>
        <Card title={t('support.sender')}>
          <dl className="adm-facts">
            <div>
              <dt>{t('support.from')}</dt>
              <dd>{ticket.name ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('support.email')}</dt>
              <dd className="adm-break">{ticket.email}</dd>
            </div>
            <div>
              <dt>{t('support.account')}</dt>
              <dd>
                {ticket.user ? (
                  <Link to={`/admin/utilizatori?id=${ticket.user.id}`}>
                    {ticket.user.name} · {t(roleKey(ticket.user.role))}
                  </Link>
                ) : (
                  t('support.guest')
                )}
              </dd>
            </div>
            <div>
              <dt>{t('support.sent')}</dt>
              <dd>{formatDateTime(ticket.createdAt)}</dd>
            </div>
          </dl>
          {ticket.account && (ticket.account.deletedAt || ticket.account.suspended) && (
            <div className="adm-callout is-bad">
              <div>
                <strong>{t(ticket.account.deletedAt ? 'support.accountDeleted' : 'support.accountSuspended')}</strong>
                <p>
                  {ticket.account.deletedAt
                    ? t('support.accountDeletedBody', { name: ticket.account.name, date: formatDate(ticket.account.deletedAt) })
                    : t('support.accountSuspendedBody', { name: ticket.account.name })}
                </p>
                <div className="adm-user-buttons">
                  {ticket.account.deletedAt && (
                    <button type="button" className="adm-btn is-small" onClick={() => setRestoring(true)}>
                      <RotateCcw size={14} /> {t('users.restore')}
                    </button>
                  )}
                  <Link to={`/admin/utilizatori?id=${ticket.account.id}`} className="adm-btn is-small is-ghost">
                    {t('support.openAccount')}
                  </Link>
                </div>
              </div>
            </div>
          )}
          {!ticket.user && ticket.account && !ticket.account.deletedAt && !ticket.account.suspended && (
            <p className="adm-muted adm-small">
              {t('support.accountByEmail')} <Link to={`/admin/utilizatori?id=${ticket.account.id}`}>{t('support.openAccount')}</Link>
            </p>
          )}
        </Card>
      </div>
      {restoring && ticket.account && (
        <ConfirmDialog
          title={t('users.restore')}
          body={t('users.restoreBody', { name: ticket.account.name, email: ticket.email })}
          confirmLabel={t('users.restore')}
          busy={busy}
          error={error}
          onCancel={() => setRestoring(false)}
          onConfirm={() => void restore()}
        />
      )}
    </>
  );
}
