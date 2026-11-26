import { useEffect, useState } from 'react';
import { UserMinus } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { followAuthors } from '@/components/FollowButton';
import { EmailOffModal, isEmailOff } from '@/components/EmailOffModal';
import type { MySubscription } from '@/components/NewsletterSignup';
import { NewsletterChoices } from '@/components/NewsletterChoices';
import { siteSettings } from '@/config';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

// Settings: what the account gets besides the bell. The newsletter at its address (every new post, some books' new
// chapters), and the authors it follows.

/** The newsletter at the account's address: every new post (on or off), and the books it follows by email. */
export function NewsletterCard() {
  const { t, lang, errorMessage } = useI18n();
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<MySubscription | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** The site's email isn't working: the dialog saying so, then no "open the email" hint. */
  const [unsent, setUnsent] = useState<'open' | 'closed' | null>(null);

  const load = () =>
    api<{ subscription: MySubscription | null }>('/me/newsletter')
      .then((data) => setSubscription(data.subscription))
      .catch(() => setSubscription(null));
  useEffect(() => void load(), []);

  if (!siteSettings.newsletter || subscription === undefined) return null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      if (isEmailOff(err)) setUnsent('open');
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Confirmed once: switched there and then. Otherwise subscribing (a confirmation email, unless the account's address
  // is confirmed; the site's email not working: a dialog says so).
  const setAllPosts = (on: boolean) =>
    run(async () => {
      if (subscription?.confirmed) {
        await api(`/newsletter/manage/${subscription.token}`, { method: 'PUT', body: { allPosts: on } });
      } else if (on) {
        await api('/newsletter/subscribe', { method: 'POST', body: { email: user!.email, lang } });
      }
    });
  const dropBook = (bookId: number) => run(() => api(`/newsletter/manage/${subscription!.token}/books/${bookId}`, { method: 'DELETE' }));
  const active = subscription?.active === true;
  const pending = subscription !== null && !subscription.confirmed;

  return (
    <section className="card prefs-card">
      <h2 className="side-title">{t('newsletter.title')}</h2>
      <p className="muted small">{t(active ? 'newsletter.settingsOn' : 'newsletter.settingsOff', { email: user!.email })}</p>
      <NewsletterChoices
        allPosts={active && subscription!.allPosts}
        books={active ? subscription!.books : []}
        busy={busy}
        onAllPosts={(on) => void setAllPosts(on)}
        onDropBook={(bookId) => void dropBook(bookId)}
      />
      {pending && !unsent && <p className="field-hint">{t('newsletter.pendingHint', { email: user!.email })}</p>}
      {error && <p className="form-error small">{error}</p>}
      {unsent === 'open' && <EmailOffModal onClose={() => setUnsent('closed')} />}
    </section>
  );
}

interface Followed {
  id: number;
  name: string;
  username: string;
  picture: string | null;
}

/** The authors the account follows (Follow on their posts), to stop following one. Not where the site has a single
 *  author (no following there). */
export function FollowingCard() {
  const { t } = useI18n();
  const [authors, setAuthors] = useState<Followed[] | null>(null);

  useEffect(() => {
    if (!followAuthors()) return;
    api<{ authors: Followed[] }>('/me/following')
      .then((data) => setAuthors(data.authors))
      .catch(() => setAuthors([]));
  }, []);

  async function unfollow(author: Followed) {
    setAuthors((list) => list?.filter((a) => a.id !== author.id) ?? null);
    await api(`/authors/${author.id}/follow`, { method: 'DELETE' }).catch(() => setAuthors((list) => (list ? [...list, author] : list)));
  }

  if (!followAuthors()) return null;
  return (
    <section className="card prefs-card">
      <h2 className="side-title">{t('follow.title')}</h2>
      {authors === null ? (
        <p className="muted small">{t('common.loading')}</p>
      ) : authors.length === 0 ? (
        <p className="muted small">{t('follow.none')}</p>
      ) : (
        <ul className="following-list">
          {authors.map((author) => (
            <li key={author.id}>
              <span className="following-person">
                <Avatar name={author.name} picture={author.picture} size={32} />
                <span>{author.name}</span>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void unfollow(author)}>
                <UserMinus size={15} /> {t('follow.unfollow')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="field-hint">{t('follow.hint')}</p>
    </section>
  );
}
