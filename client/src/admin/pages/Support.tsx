import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, FileText, LifeBuoy, Mail, Paperclip, RotateCcw } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import type { Ticket, TicketSummary } from '@/admin/types';
import { Badge, Card, ConfirmDialog, Empty, ErrorNote, LoadMore, Loading, PageHead, roleKey } from '@/admin/ui';
import { ApiError, api } from '@/lib/api';
import { refreshUnread } from '@/lib/unread';

const PAGE = 20;
const category = (value: string) => `support.cat.${value}` as AdminKey;

/** Support tickets, newest first; the ones not opened yet are marked. Replies go by email (no replies in the app yet). */
export function SupportPage() {
  const { t, timeAgo, formatDateTime } = useAdminI18n();
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);

  const load = useCallback(async (offset: number) => {
    const data = await api<{ tickets: TicketSummary[]; hasMore: boolean }>(`/admin/support?offset=${offset}&limit=${PAGE}`);
    setTickets((current) => (offset === 0 ? data.tickets : [...(current ?? []), ...data.tickets]));
    setHasMore(data.hasMore);
  }, []);

  useEffect(() => {
    load(0).catch(() => setError(true));
  }, [load]);

  return (
    <>
      <PageHead title={t('nav.support')} subtitle={t('support.subtitle')} />
      <Card flush>
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
                      <Badge>{t(category(ticket.category))}</Badge>
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
                    <time className="adm-muted" dateTime={ticket.createdAt} title={formatDateTime(ticket.createdAt)}>
                      {timeAgo(ticket.createdAt)}
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

/** One ticket: who sent it (and their account), what they wrote, the files, and a reply by email. */
export function TicketPage() {
  const { id = '' } = useParams();
  const { t, formatDate, formatDateTime, errorMessage } = useAdminI18n();
  const { refreshOverview } = useAdmin();
  const [ticket, setTicket] = useState<Ticket | null>(null);
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
    api<{ ticket: Ticket }>(`/admin/support/${encodeURIComponent(id)}`)
      .then((data) => {
        setTicket(data.ticket);
        setStatus('ready');
        // Opening it marked it seen, and its notification read.
        refreshOverview();
        void refreshUnread();
      })
      .catch((err) => setStatus(err instanceof ApiError && err.status === 404 ? 'missing' : 'error'));
  }, [id, refreshOverview, reload]);

  const file = (fileId: number) => `/api/admin/support/${ticket?.id}/files/${fileId}`;
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
      <PageHead title={ticket.title} subtitle={<Badge>{t(category(ticket.category))}</Badge>} actions={back} />
      <div className="adm-grid is-2-1">
        <Card title={t('support.message')}>
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
          <a className="adm-btn is-primary is-block" href={`mailto:${ticket.email}?subject=${encodeURIComponent(`Re: ${ticket.title}`)}`}>
            <Mail size={16} /> {t('support.reply')}
          </a>
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
