import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { FileText, ImageIcon, LifeBuoy, PenLine, Send } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { PageBand } from '@/components/PageBand';
import { site } from '@/config';
import { useAuth } from '@/context/auth';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { refreshUnread } from '@/lib/unread';

// A signed-in person's support tickets (/suport/tichete) and each one's conversation (/suport/tichete/{id}): the
// answers from the site's team (they come by email too), and theirs, written here (server/src/routes/support.ts).

export type TicketStatus = 'open' | 'answered' | 'closed';

export interface MyTicket {
  id: number;
  title: string;
  category: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  answers: number;
  /** Answers not read yet. */
  unread: number;
}

interface Reply {
  id: number;
  staff: boolean;
  author: { id: number | null; name: string; picture: string | null };
  body: string;
  createdAt: string;
}

interface Ticket {
  id: number;
  title: string;
  category: string;
  body: string;
  email: string;
  status: TicketStatus;
  createdAt: string;
  files: { id: number; name: string; mime: string; size: number }[];
  replies: Reply[];
}

const STATUS_CLASS: Record<TicketStatus, string> = { open: 'badge-status-scheduled', answered: 'badge-status-published', closed: 'badge-status-draft' };

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const { t } = useI18n();
  return <span className={`badge ${STATUS_CLASS[status]}`}>{t(`support.state.${status}` as MessageKey)}</span>;
}

/** The tickets as a list: each with its state, how many answers, the unread ones marked. */
export function TicketList({ tickets }: { tickets: MyTicket[] }) {
  const { t, formatDate } = useI18n();
  return (
    <ul className="support-tickets">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <Link to={`/suport/tichete/${ticket.id}`} className={`support-ticket${ticket.unread ? ' is-unread' : ''}`}>
            <span className="support-ticket-main">
              <strong>{ticket.title}</strong>
              <span className="muted small">
                {formatDate(new Date(ticket.updatedAt))}
                {ticket.answers > 0 && <> · {t('support.answers', { n: ticket.answers })}</>}
                {ticket.unread > 0 && <> · {t('support.unread', { n: ticket.unread })}</>}
              </span>
            </span>
            <TicketStatusBadge status={ticket.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Every ticket the person sent signed in, the latest activity first. */
export function SupportTicketsPage() {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  const location = useLocation();
  const [tickets, setTickets] = useState<MyTicket[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user) return;
    api<{ tickets: MyTicket[] }>('/support/tickets')
      .then((data) => setTickets(data.tickets))
      .catch(() => setFailed(true));
  }, [user]);

  if (loading) return null;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return (
    <div className="container support-page">
      <HeaderBackLink />
      <PageBand
        title={t('support.myTickets')}
        line={t('support.myTicketsLine')}
        actions={
          <Link to="/suport" className="btn btn-soft btn-sm">
            <PenLine size={16} aria-hidden="true" /> {t('support.newTicket')}
          </Link>
        }
      />
      <section className="card support-tickets-card">
        {failed ? (
          <p className="form-error">{t('error.generic')}</p>
        ) : !tickets ? (
          <p className="muted">{t('common.loading')}</p>
        ) : tickets.length === 0 ? (
          <div className="support-empty">
            <LifeBuoy size={28} aria-hidden="true" />
            <p className="muted">{t('support.noTickets')}</p>
          </div>
        ) : (
          <TicketList tickets={tickets} />
        )}
      </section>
    </div>
  );
}

/** One ticket: what the person wrote (and attached), the answers, and theirs to write. Opening it reads the answers. */
export function SupportTicketPage() {
  const { id = '' } = useParams();
  const { t, formatDate, errorMessage } = useI18n();
  const { user, loading } = useAuth();
  const location = useLocation();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    api<{ ticket: Ticket }>(`/support/tickets/${encodeURIComponent(id)}`)
      .then((data) => {
        setTicket(data.ticket);
        setState('ready');
        void refreshUnread(); // its answers' notifications are read now
      })
      .catch((err) => setState(err instanceof ApiError && err.status === 404 ? 'missing' : 'error'));
  }, [id, user]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!ticket || answer.trim().length < 2) return;
    setSending(true);
    setError('');
    try {
      const data = await api<{ replies: Reply[]; status: TicketStatus }>(`/support/tickets/${ticket.id}/replies`, { method: 'POST', body: { body: answer.trim() } });
      setTicket({ ...ticket, replies: data.replies, status: data.status });
      setAnswer('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  if (loading) return null;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (state !== 'ready' || !ticket) {
    return (
      <div className="container support-page">
        <HeaderBackLink />
        <section className="card support-tickets-card">
          {state === 'loading' ? (
            <p className="muted">{t('common.loading')}</p>
          ) : (
            <p className="form-error">{t(state === 'missing' ? 'support.ticketMissing' : 'error.generic')}</p>
          )}
          <Link to="/suport/tichete" className="btn btn-soft btn-sm">
            {t('support.myTickets')}
          </Link>
        </section>
      </div>
    );
  }

  const file = (fileId: number) => `/api/support/tickets/${ticket.id}/files/${fileId}`;
  return (
    <div className="container support-page">
      <HeaderBackLink />
      <PageBand
        title={ticket.title}
        line={
          <span className="support-ticket-line">
            <TicketStatusBadge status={ticket.status} /> {t(`support.cat.${ticket.category}` as MessageKey)} · {formatDate(new Date(ticket.createdAt))}
          </span>
        }
        actions={
          <Link to="/suport/tichete" className="btn btn-soft btn-sm">
            {t('support.myTickets')}
          </Link>
        }
      />
      <section className="card support-thread-card">
        <ol className="support-thread">
          <li className="support-msg is-mine">
            <Avatar name={user.name} picture={user.picture} size={32} />
            <div className="support-msg-box">
              <p className="support-msg-meta">
                <strong>{t('support.you')}</strong> · <time dateTime={ticket.createdAt}>{formatDate(new Date(ticket.createdAt))}</time>
              </p>
              <div className="support-msg-body">{ticket.body}</div>
              {ticket.files.length > 0 && (
                <ul className="support-files">
                  {ticket.files.map((f) => (
                    <li key={f.id}>
                      {f.mime.startsWith('image/') ? <ImageIcon size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}
                      <a href={file(f.id)} target="_blank" rel="noopener noreferrer" className="support-file-name">
                        {f.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
          {ticket.replies.map((reply) => (
            <li key={reply.id} className={`support-msg${reply.staff ? ' is-staff' : ' is-mine'}`}>
              <Avatar name={reply.author.name} picture={reply.author.picture} size={32} />
              <div className="support-msg-box">
                <p className="support-msg-meta">
                  <strong>{reply.staff ? t('support.team', { site: site.name }) : t('support.you')}</strong>
                  {reply.staff && <> · {reply.author.name}</>} · <time dateTime={reply.createdAt}>{formatDate(new Date(reply.createdAt))}</time>
                </p>
                <div className="support-msg-body">{reply.body}</div>
              </div>
            </li>
          ))}
        </ol>
        {ticket.replies.every((reply) => !reply.staff) && <p className="muted small support-waiting">{t('support.waiting', { email: ticket.email })}</p>}
        <form className="support-answer" onSubmit={send}>
          <label className="field">
            <span className="field-label">{t('support.yourAnswer')}</span>
            <textarea
              className="input textarea"
              rows={4}
              maxLength={5000}
              value={answer}
              placeholder={t('support.yourAnswerPlaceholder')}
              onChange={(event) => setAnswer(event.target.value)}
            />
            <span className="field-hint">{t(ticket.status === 'closed' ? 'support.closedHint' : 'support.answerHint')}</span>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="support-actions">
            <button type="submit" className="btn btn-primary" disabled={sending || answer.trim().length < 2}>
              <Send size={16} aria-hidden="true" /> {sending ? t('support.sending') : t('support.sendAnswer')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
