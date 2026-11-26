import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { MailCheck, Mail } from 'lucide-react';
import { EmailOffModal, isEmailOff } from '@/components/EmailOffModal';
import { siteSettings } from '@/config';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { markSubscribed } from '@/lib/newsletterSheet';
import type { NotifyBook } from '@/lib/newsletterSheet';

/** The reply to subscribing: waiting to be confirmed (a link went to the address), on, or on already. */
export interface SubscribeReply {
  status: 'pending' | 'confirmed' | 'already';
}

/** The account's subscription, as /me/newsletter has it. */
export interface MySubscription {
  email: string;
  allPosts: boolean;
  books: { id: number; title: string; slug: string }[];
  active: boolean;
  confirmed: boolean;
  token: string;
}

/**
 * Subscribe by email (server/src/lib/newsletter.ts): to every new post, or (`book`) to a book's new chapters ("Notify
 * me"). The address is the account's, for someone signed in. A confirmation link goes to it (unless it's the account's
 * confirmed address); when the site's email isn't set up yet, a dialog says so. Hidden when the newsletter is off in
 * the admin panel. Signed in and already getting it, it shows nothing, unless `keep` (a sheet opened for it), where it
 * says so. In a sheet (`variant="sheet"`) the title is the sheet's own (or "By email", `ways`), and `later` adds a
 * "Not now" under the button.
 */
export function NewsletterSignup({
  variant = 'card',
  keep = false,
  later,
  book,
  ways,
}: {
  variant?: 'card' | 'wide' | 'sheet';
  keep?: boolean;
  later?: () => void;
  book?: NotifyBook;
  /** One of a sheet's ways of hearing of what's new: titled "By email", beside "On this device". */
  ways?: boolean;
}) {
  const { t, lang, errorMessage } = useI18n();
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email ?? '');
  const [state, setState] = useState<'idle' | 'sending' | 'pending' | 'confirmed' | 'already'>('idle');
  const [error, setError] = useState('');
  const [unsent, setUnsent] = useState(false);
  /** Signed in and already getting it: nothing to offer (Settings has the subscription). */
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    if (!user || !siteSettings.newsletter) return;
    // The account loads after the page: its address, unless something was typed already.
    setEmail((current) => current || user.email);
    api<{ subscription: MySubscription | null }>('/me/newsletter')
      .then(({ subscription: mine }) =>
        setSubscribed(Boolean(mine?.active && (mine.allPosts || (book && mine.books.some((followed) => followed.id === book.id))))),
      )
      .catch(() => undefined);
  }, [user?.id, book?.id]);

  if (!siteSettings.newsletter) return null;
  // Its own title, but in a sheet (whose head has it); one of the sheet's ways: "By email" (the other: "On this device").
  const titled = variant !== 'sheet' || Boolean(ways);
  const heading = ways ? t('stay.email') : t('newsletter.title');
  const sectionProps = titled ? { 'aria-labelledby': 'newsletter-title' } : { 'aria-label': heading };
  const title = titled && <h2 id="newsletter-title">{heading}</h2>;
  /** Getting it: what the head says. */
  const onText = (address: string) => (book ? t('books.notifyEmailOn', { email: address }) : t('newsletter.settingsOn', { email: address }));
  if (subscribed && state === 'idle') {
    if (!keep) return null;
    return (
      <section className={`newsletter card newsletter-${variant}`} {...sectionProps}>
        <div className="newsletter-head">
          <span className="newsletter-icon" aria-hidden="true">
            <MailCheck size={20} />
          </span>
          <div>
            {title}
            <p className="muted small">{onText(user?.email ?? email)}</p>
          </div>
        </div>
      </section>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState('sending');
    setError('');
    try {
      const reply = await api<SubscribeReply>('/newsletter/subscribe', { method: 'POST', body: { email: email.trim(), lang, ...(book ? { bookId: book.id } : {}) } });
      setState(reply.status);
      if (!book) markSubscribed();
    } catch (err) {
      // The site's email isn't working: the form stays, to try again later.
      if (isEmailOff(err)) setUnsent(true);
      else setError(errorMessage(err));
      setState('idle');
    }
  }

  const done = state === 'pending' || state === 'confirmed' || state === 'already';
  const doneText = state === 'pending' || !book ? t(`newsletter.done.${state as 'pending'}`, { email: email.trim() }) : onText(email.trim());
  return (
    <section className={`newsletter card newsletter-${variant}`} {...sectionProps}>
      <div className="newsletter-head">
        <span className="newsletter-icon" aria-hidden="true">
          {done ? <MailCheck size={20} /> : <Mail size={20} />}
        </span>
        <div>
          {title}
          <p className="muted small">{done ? doneText : book ? t('books.notifyEmailHint') : ways ? t('stay.emailHint') : t('newsletter.body')}</p>
        </div>
      </div>
      {!done && (
        <form className="newsletter-form" onSubmit={submit}>
          <input
            className="input"
            type="email"
            required
            maxLength={255}
            value={email}
            placeholder={t('auth.email')}
            aria-label={t('auth.email')}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
            {state === 'sending' ? t('common.loading') : t('newsletter.subscribe')}
          </button>
          {error && <p className="form-error small">{error}</p>}
          {later && (
            <button type="button" className="btn btn-ghost" onClick={later}>
              {t('newsletter.later')}
            </button>
          )}
        </form>
      )}
      {unsent && <EmailOffModal onClose={() => setUnsent(false)} />}
    </section>
  );
}
