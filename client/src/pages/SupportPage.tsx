import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, FileText, ImageIcon, LogIn, MessageCircleQuestion, MessagesSquare, Paperclip, ScrollText, SlidersHorizontal, UserRound, Wrench, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { PageBand } from '@/components/PageBand';
import { TERMS_PATH } from '@/config';
import { SelectField } from '@/components/SelectField';
import { useAuth } from '@/context/auth';
import { TicketList } from '@/pages/SupportTicketsPage';
import type { MyTicket } from '@/pages/SupportTicketsPage';
import { api, sendSupport } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const MAX_FILES = 3;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain'];
const CATEGORIES = ['account', 'content', 'technical', 'other'] as const;
const CATEGORY_ICONS: Record<(typeof CATEGORIES)[number], LucideIcon> = {
  account: UserRound,
  content: FileText,
  technical: Wrench,
  other: MessageCircleQuestion,
};

/** "2,4 MB", "830 KB". */
function size(bytes: number, locale: string) {
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return bytes >= 1024 * 1024 ? `${format.format(bytes / 1024 / 1024)} MB` : `${format.format(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/**
 * Support (anyone): a message to the administrators, with an email to answer to, a title, a description and up to
 * three attachments. It's kept on the server (server/src/routes/support.ts); answers come by email, and, sent signed
 * in, into the account too (the conversation: /suport/tichete), which the side says, with the person's tickets.
 */
export function SupportPage() {
  const { t, locale, errorMessage } = useI18n();
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('other');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  /** Hidden from people: only robots fill it in. */
  const [website, setWebsite] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  /** The ticket just sent signed in: its conversation. */
  const [sentId, setSentId] = useState<number | null>(null);
  const [tickets, setTickets] = useState<MyTicket[] | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Signed in: their tickets, the latest first (a few here, all on their page).
  useEffect(() => {
    if (!user) {
      setTickets(null);
      return;
    }
    api<{ tickets: MyTicket[] }>('/support/tickets')
      .then((data) => setTickets(data.tickets))
      .catch(() => setTickets([]));
  }, [user, sentId]);

  // Signed in: their email and name, unless something's already typed.
  useEffect(() => {
    if (!user) return;
    setEmail((current) => current || user.email);
    setName((current) => current || user.name);
  }, [user]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError('');
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= MAX_FILES) {
        setError(t('support.tooMany'));
        break;
      }
      if (!FILE_TYPES.includes(file.type)) {
        setError(t('support.badType', { name: file.name }));
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(t('support.tooBig', { name: file.name }));
        continue;
      }
      next.push(file);
    }
    setFiles(next);
    if (picker.current) picker.current.value = '';
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSending(true);
    try {
      const form = new FormData();
      form.set('email', email.trim());
      form.set('name', name.trim());
      form.set('category', category);
      form.set('title', title.trim());
      form.set('body', body.trim());
      form.set('website', website);
      for (const file of files) form.append('files', file, file.name);
      const sent = await sendSupport(form);
      setSentTo(email.trim());
      setSentId(user && sent.id ? sent.id : null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  if (sentTo) {
    return (
      <div className="container support-page">
        <HeaderBackLink />
        <div className="card support-sent" role="status">
          <CheckCircle2 size={44} aria-hidden="true" />
          <h1>{t('support.sent')}</h1>
          <p className="muted">{t(sentId ? 'support.sentHintAccount' : 'support.sentHint', { email: sentTo })}</p>
          <div className="support-sent-actions">
            {sentId && (
              <Link to={`/suport/tichete/${sentId}`} className="btn btn-primary">
                <MessagesSquare size={16} aria-hidden="true" /> {t('support.seeTicket')}
              </Link>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setSentTo(null);
                setSentId(null);
                setTitle('');
                setBody('');
                setFiles([]);
              }}
            >
              {t('support.another')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container support-page">
      <HeaderBackLink />
      <PageBand title={t('support.title')} line={t('support.subtitle')} />

      {/* The form, and beside it (under it on phones) what happens next and where else to look. */}
      <div className="support-layout">

      <form className="card support-form" onSubmit={submit} noValidate={false}>
        <div className="support-pair">
          <label className="field">
            <span className="field-label">{t('support.email')}</span>
            <input className="input" type="email" required maxLength={190} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{t('support.name')}</span>
            <input className="input" type="text" maxLength={100} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        </div>

        <SelectField
          label={t('support.category')}
          value={category}
          options={CATEGORIES.map((value) => ({ value, label: t(`support.cat.${value}`), icon: CATEGORY_ICONS[value] }))}
          onChange={setCategory}
        />

        <label className="field">
          <span className="field-label">{t('support.subject')}</span>
          <input
            className="input"
            type="text"
            required
            minLength={3}
            maxLength={160}
            placeholder={t('support.subjectPlaceholder')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">{t('support.body')}</span>
          <textarea
            className="input textarea support-body"
            required
            minLength={10}
            maxLength={5000}
            rows={7}
            placeholder={t('support.bodyPlaceholder')}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>

        {/* Robots fill in every field; people never see this one. */}
        <label className="support-trap" aria-hidden="true">
          Website
          <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
        </label>

        <div className="field">
          <span className="field-label">{t('support.files')}</span>
          {files.length > 0 && (
            <ul className="support-files">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`}>
                  {file.type.startsWith('image/') ? <ImageIcon size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}
                  <span className="support-file-name">{file.name}</span>
                  <span className="muted small">{size(file.size, locale)}</span>
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    aria-label={t('support.removeFile', { name: file.name })}
                    onClick={() => setFiles(files.filter((_, i) => i !== index))}
                  >
                    <X size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {files.length < MAX_FILES && (
            <button type="button" className="btn btn-secondary btn-sm support-add" onClick={() => picker.current?.click()}>
              <Paperclip size={16} /> {t('support.addFiles')}
            </button>
          )}
          <input ref={picker} type="file" multiple hidden accept={FILE_TYPES.join(',')} onChange={(event) => addFiles(event.target.files)} />
          <span className="field-hint">{t('support.filesHint')}</span>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="support-actions">
          <button type="submit" className="btn btn-primary" disabled={sending}>
            {sending ? t('support.sending') : t('support.send')}
          </button>
        </div>
      </form>

        <aside className="support-side">
          {/* Where the answers come: email always, the account too (with its history); signed in, their tickets. */}
          {user ? (
            <section className="card support-account">
              <h2 className="side-title">{t('support.yourTickets')}</h2>
              <p className="muted small">{t('support.accountOn')}</p>
              {tickets && tickets.length > 0 ? (
                <>
                  <TicketList tickets={tickets.slice(0, 4)} />
                  <Link to="/suport/tichete" className="support-link">
                    <MessagesSquare size={17} aria-hidden="true" />
                    <span>
                      <strong>{t('support.allTickets', { n: tickets.length })}</strong>
                    </span>
                  </Link>
                </>
              ) : (
                tickets && <p className="muted small">{t('support.noTickets')}</p>
              )}
            </section>
          ) : (
            <section className="card support-account">
              <h2 className="side-title">{t('support.accountTitle')}</h2>
              <p className="muted small">{t('support.accountBody')}</p>
              <Link to="/login?next=%2Fsuport" className="btn btn-soft btn-sm">
                <LogIn size={16} aria-hidden="true" /> {t('support.signIn')}
              </Link>
            </section>
          )}
          <section className="card support-next">
            <h2 className="side-title">{t('support.nextTitle')}</h2>
            <ol>
              {(['support.next1', 'support.next2', 'support.next3'] as const).map((key, index) => (
                <li key={key}>
                  <span className="support-next-no" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span>{t(key)}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="card support-links">
            <h2 className="side-title">{t('support.linksTitle')}</h2>
            {user && (
              <Link to="/setari" className="support-link">
                <SlidersHorizontal size={17} aria-hidden="true" />
                <span>
                  <strong>{t('support.linkSettings')}</strong>
                  <span className="muted small">{t('support.linkSettingsHint')}</span>
                </span>
              </Link>
            )}
            <Link to={TERMS_PATH} className="support-link">
              <ScrollText size={17} aria-hidden="true" />
              <span>
                <strong>{t('footer.terms')}</strong>
                <span className="muted small">{t('support.linkTermsHint')}</span>
              </span>
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
