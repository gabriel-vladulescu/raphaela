import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { MailCheck, Mail } from 'lucide-react';
import { siteSettings } from '@/config';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Subscribe to new posts by email (server/src/lib/newsletter.ts): the address (the account's, for someone signed in),
 * at once or once a week. A confirmation link goes to it (unless it's the account's confirmed address). Hidden when
 * the newsletter is off in the admin panel.
 */
export function NewsletterSignup({ variant = 'card' }: { variant?: 'card' | 'wide' }) {
  const { t, lang, errorMessage } = useI18n();
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email ?? '');
  const [frequency, setFrequency] = useState<'instant' | 'weekly'>('weekly');
  const [state, setState] = useState<'idle' | 'sending' | 'pending' | 'confirmed' | 'already'>('idle');
  const [error, setError] = useState('');
  /** Signed in and already getting it: nothing to offer (Settings has the subscription). */
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    if (!user || !siteSettings.newsletter) return;
    // The account loads after the page: its address, unless something was typed already.
    setEmail((current) => current || user.email);
    api<{ subscription: { active: boolean; confirmed: boolean } | null }>('/me/newsletter')
      .then(({ subscription }) => setSubscribed(Boolean(subscription?.active && subscription.confirmed)))
      .catch(() => undefined);
  }, [user?.id]);

  if (!siteSettings.newsletter || (subscribed && state === 'idle')) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState('sending');
    setError('');
    try {
      const { status } = await api<{ status: 'pending' | 'confirmed' | 'already' }>('/newsletter/subscribe', {
        method: 'POST',
        body: { email: email.trim(), frequency, lang },
      });
      setState(status);
    } catch (err) {
      setError(errorMessage(err));
      setState('idle');
    }
  }

  const done = state === 'pending' || state === 'confirmed' || state === 'already';
  return (
    <section className={`newsletter card newsletter-${variant}`} aria-labelledby="newsletter-title">
      <div className="newsletter-head">
        <span className="newsletter-icon" aria-hidden="true">
          {done ? <MailCheck size={20} /> : <Mail size={20} />}
        </span>
        <div>
          <h2 id="newsletter-title">{t('newsletter.title')}</h2>
          <p className="muted small">{done ? t(`newsletter.done.${state}`, { email: email.trim() }) : t('newsletter.body')}</p>
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
          <div className="segmented newsletter-frequency" role="group" aria-label={t('newsletter.frequency')}>
            {(['weekly', 'instant'] as const).map((value) => (
              <button key={value} type="button" className={frequency === value ? 'is-selected' : ''} aria-pressed={frequency === value} onClick={() => setFrequency(value)}>
                {t(`newsletter.${value}`)}
              </button>
            ))}
          </div>
          <button type="submit" className="btn btn-primary" disabled={state === 'sending'}>
            {state === 'sending' ? t('common.loading') : t('newsletter.subscribe')}
          </button>
          {error && <p className="form-error small">{error}</p>}
        </form>
      )}
    </section>
  );
}
