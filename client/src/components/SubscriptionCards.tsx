import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { UserMinus } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { siteSettings } from '@/config';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { articlesPath } from '@/lib/paths';

// Settings: what the account gets besides the bell. The newsletter at its address, and the authors it follows.

interface Subscription {
  frequency: 'instant' | 'weekly';
  active: boolean;
  confirmed: boolean;
  token: string;
}

/** The newsletter at the account's address: on (how often) or off. */
export function NewsletterCard() {
  const { t, lang, errorMessage } = useI18n();
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    api<{ subscription: Subscription | null }>('/me/newsletter')
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
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const subscribe = (frequency: Subscription['frequency']) =>
    run(() => api('/newsletter/subscribe', { method: 'POST', body: { email: user!.email, frequency, lang } }));
  const on = subscription?.active === true;
  const pending = subscription !== null && !subscription.confirmed && subscription.active === false;

  return (
    <section className="card prefs-card">
      <h2 className="side-title">{t('newsletter.title')}</h2>
      <p className="muted small">{t(on ? 'newsletter.settingsOn' : 'newsletter.settingsOff', { email: user!.email })}</p>
      <div className="prefs-row">
        <div className="segmented" role="group" aria-label={t('newsletter.frequency')}>
          {(['weekly', 'instant'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={on && subscription!.frequency === value ? 'is-selected' : ''}
              aria-pressed={on && subscription!.frequency === value}
              disabled={busy}
              onClick={() =>
                void (on ? run(() => api(`/newsletter/manage/${subscription!.token}`, { method: 'PUT', body: { frequency: value } })) : subscribe(value))
              }
            >
              {t(`newsletter.${value}`)}
            </button>
          ))}
        </div>
        {pending && <p className="field-hint">{t('newsletter.pendingHint', { email: user!.email })}</p>}
        {on && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => api(`/newsletter/unsubscribe/${subscription!.token}`, { method: 'POST' }))}>
            {t('newsletter.unsubscribe')}
          </button>
        )}
      </div>
      {error && <p className="form-error small">{error}</p>}
    </section>
  );
}

interface Followed {
  id: number;
  name: string;
  username: string;
  picture: string | null;
}

/** The authors the account follows (Follow on their posts), to stop following one. */
export function FollowingCard() {
  const { t } = useI18n();
  const [authors, setAuthors] = useState<Followed[] | null>(null);

  useEffect(() => {
    api<{ authors: Followed[] }>('/me/following')
      .then((data) => setAuthors(data.authors))
      .catch(() => setAuthors([]));
  }, []);

  async function unfollow(author: Followed) {
    setAuthors((list) => list?.filter((a) => a.id !== author.id) ?? null);
    await api(`/authors/${author.id}/follow`, { method: 'DELETE' }).catch(() => setAuthors((list) => (list ? [...list, author] : list)));
  }

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
              <Link to={articlesPath(author.username)} className="following-person">
                <Avatar name={author.name} picture={author.picture} size={32} />
                <span>{author.name}</span>
              </Link>
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
