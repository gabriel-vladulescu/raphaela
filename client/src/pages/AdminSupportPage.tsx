import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { FileText, Mail, Paperclip } from 'lucide-react';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { refreshUnread } from '@/lib/unread';

interface TicketSummary {
  id: number;
  name: string | null;
  email: string;
  category: string;
  title: string;
  preview: string;
  createdAt: string;
  seen: boolean;
  files: number;
}

interface Ticket {
  id: number;
  name: string | null;
  email: string;
  category: string;
  title: string;
  body: string;
  createdAt: string;
  user: { id: number; name: string; role: string } | null;
  files: { id: number; name: string; mime: string; size: number }[];
}

const category = (value: string) => `support.cat.${value}` as MessageKey;

/** Administrators: the support tickets, newest first, the ones not opened yet marked "Nou". No replies yet. */
export function AdminSupportPage() {
  const { t, timeAgo } = useI18n();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  async function load(offset: number) {
    const data = await api<{ tickets: TicketSummary[]; hasMore: boolean }>(`/admin/support?offset=${offset}&limit=20`);
    setTickets((list) => (offset ? [...list, ...data.tickets] : data.tickets));
    setHasMore(data.hasMore);
  }

  useEffect(() => {
    load(0)
      .then(() => setStatus('ready'))
      .catch(() => setStatus('error'));
  }, []);

  return (
    <div className="container support-admin">
      <HeaderBackLink to="/admin" label={t('admin.back')} />
      <div className="support-head">
        <h1>{t('adminSupport.title')}</h1>
        <p className="muted">{t('adminSupport.subtitle')}</p>
      </div>
      {status === 'loading' ? (
        <p className="muted">{t('common.loading')}</p>
      ) : status === 'error' ? (
        <p className="form-error">{t('error.generic')}</p>
      ) : tickets.length === 0 ? (
        <div className="empty-state card">
          <span className="empty-glyph" aria-hidden="true">
            ✦
          </span>
          <p>{t('adminSupport.empty')}</p>
        </div>
      ) : (
        <ul className="ticket-list card">
          {tickets.map((ticket) => (
            <li key={ticket.id} className={ticket.seen ? '' : 'is-new'}>
              <Link to={`/admin/suport/${ticket.id}`} className="ticket-row">
                <span className="ticket-main">
                  <span className="ticket-title">
                    {!ticket.seen && <span className="badge badge-featured">{t('adminSupport.new')}</span>}
                    {ticket.title}
                  </span>
                  <span className="ticket-preview">{ticket.preview}</span>
                  <span className="ticket-meta">
                    <span>{ticket.name ? `${ticket.name} · ${ticket.email}` : ticket.email}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t(category(ticket.category))}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={ticket.createdAt}>{timeAgo(ticket.createdAt)}</time>
                    {ticket.files > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          <Paperclip size={13} aria-hidden="true" /> {ticket.files}
                        </span>
                      </>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <button type="button" className="btn btn-secondary support-more" onClick={() => void load(tickets.length)}>
          {t('adminSupport.older')}
        </button>
      )}
    </div>
  );
}

/** One ticket: the message, who sent it (and their account, if any), and the attachments (pictures shown). */
export function AdminSupportTicketPage() {
  const { id = '' } = useParams();
  const { t, formatDateTime } = useI18n();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    api<{ ticket: Ticket }>(`/admin/support/${encodeURIComponent(id)}`)
      .then((data) => {
        setTicket(data.ticket);
        setStatus('ready');
        void refreshUnread(); // opening it marked its notification read
      })
      .catch((err) => setStatus(err instanceof ApiError && err.status === 404 ? 'missing' : 'error'));
  }, [id]);

  const file = (fileId: number) => `/api/admin/support/${ticket?.id}/files/${fileId}`;

  return (
    <div className="container support-admin">
      <HeaderBackLink to="/admin/suport" label={t('adminSupport.back')} />
      {status === 'loading' ? (
        <p className="muted">{t('common.loading')}</p>
      ) : status !== 'ready' || !ticket ? (
        <p className="form-error">{t(status === 'missing' ? 'page.notFound' : 'error.generic')}</p>
      ) : (
        <article className="card ticket">
          <header className="ticket-head">
            <span className="chip">{t(category(ticket.category))}</span>
            <h1>{ticket.title}</h1>
            <p className="ticket-meta">
              <span>
                {t('adminSupport.from')}: <strong>{ticket.name ?? ticket.email}</strong>
                {ticket.name && <> &lt;{ticket.email}&gt;</>}
              </span>
              <span aria-hidden="true">·</span>
              <span>{ticket.user ? t('adminSupport.account', { name: ticket.user.name, role: t(`role.${ticket.user.role}` as MessageKey) }) : t('adminSupport.guest')}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={ticket.createdAt}>{formatDateTime(ticket.createdAt)}</time>
            </p>
          </header>
          <div className="ticket-body">{ticket.body}</div>
          {ticket.files.length > 0 && (
            <section className="ticket-files" aria-label={t('support.files')}>
              <h2 className="side-title">{t('adminSupport.filesCount', { n: ticket.files.length })}</h2>
              <div className="ticket-file-grid">
                {ticket.files.map((f) =>
                  f.mime.startsWith('image/') ? (
                    <a key={f.id} href={file(f.id)} target="_blank" rel="noopener noreferrer" className="ticket-image">
                      <img src={file(f.id)} alt={f.name} loading="lazy" />
                      <span>{f.name}</span>
                    </a>
                  ) : (
                    <a key={f.id} href={file(f.id)} target="_blank" rel="noopener noreferrer" className="ticket-file">
                      <FileText size={20} aria-hidden="true" />
                      <span>{f.name}</span>
                    </a>
                  ),
                )}
              </div>
            </section>
          )}
          <div className="ticket-actions">
            <a className="btn btn-primary" href={`mailto:${ticket.email}?subject=${encodeURIComponent(`Re: ${ticket.title}`)}`}>
              <Mail size={16} /> {t('adminSupport.reply')}
            </a>
          </div>
        </article>
      )}
    </div>
  );
}
