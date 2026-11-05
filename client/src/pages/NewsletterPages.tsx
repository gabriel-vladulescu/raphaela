import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { LoaderCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Outcome, Shell } from '@/pages/AccountLinkPages';

// The pages the newsletter's emails lead to (server/src/lib/newsletter.ts): confirming a subscription, and changing
// or stopping it.

/** /newsletter/confirmare?token=…: the link in the confirmation email. */
export function NewsletterConfirmPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [result, setResult] = useState<{ email: string } | 'invalid' | null>(token ? null : 'invalid');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api<{ email: string }>('/newsletter/confirm', { method: 'POST', body: { token } })
      .then(setResult)
      .catch(() => setResult('invalid'));
  }, [token]);

  return (
    <Shell back="/">
      {result === null ? (
        <p className="auth-wait muted">
          <LoaderCircle size={18} className="spin" /> {t('verify.checking')}
        </p>
      ) : result === 'invalid' ? (
        <Outcome tone="error" title={t('newsletter.invalidTitle')} body={t('newsletter.invalidBody')}>
          <Link to="/" className="btn btn-primary">
            {t('post.backHome')}
          </Link>
        </Outcome>
      ) : (
        <Outcome tone="ok" title={t('newsletter.confirmedTitle')} body={t('newsletter.confirmedBody', { email: result.email })}>
          <Link to={`/newsletter/${token}`} className="btn btn-secondary">
            {t('newsletter.manage')}
          </Link>
          <Link to="/" className="btn btn-primary">
            {t('newsletter.toPosts')}
          </Link>
        </Outcome>
      )}
    </Shell>
  );
}

interface Subscription {
  email: string;
  frequency: 'instant' | 'weekly';
  active: boolean;
  confirmed: boolean;
}

/** /newsletter/:token: "change or unsubscribe", from every newsletter email (and Settings). */
export function NewsletterManagePage() {
  const { t, errorMessage } = useI18n();
  const { token = '' } = useParams();
  const [subscription, setSubscription] = useState<Subscription | null | 'invalid'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<{ subscription: Subscription }>(`/newsletter/manage/${encodeURIComponent(token)}`)
      .then((data) => setSubscription(data.subscription))
      .catch(() => setSubscription('invalid'));
  }, [token]);

  async function run(action: () => Promise<unknown>, next: Partial<Subscription>) {
    if (!subscription || subscription === 'invalid') return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await action();
      setSubscription({ ...subscription, ...next });
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (subscription === null) {
    return (
      <Shell back="/">
        <p className="auth-wait muted">
          <LoaderCircle size={18} className="spin" /> {t('common.loading')}
        </p>
      </Shell>
    );
  }
  if (subscription === 'invalid') {
    return (
      <Shell back="/">
        <Outcome tone="error" title={t('newsletter.invalidTitle')} body={t('newsletter.invalidBody')}>
          <Link to="/" className="btn btn-primary">
            {t('post.backHome')}
          </Link>
        </Outcome>
      </Shell>
    );
  }

  const setFrequency = (frequency: Subscription['frequency']) =>
    run(() => api(`/newsletter/manage/${token}`, { method: 'PUT', body: { frequency } }), { frequency, active: subscription.confirmed });

  // Not confirmed yet: this link is the confirmation email's own (the same token), so it confirms here too.
  if (!subscription.confirmed) {
    return (
      <Shell back="/">
        <div className="auth-header">
          <h1>{t('newsletter.manageTitle')}</h1>
          <p className="muted">{t('newsletter.manageUnconfirmed', { email: subscription.email })}</p>
        </div>
        <div className="auth-form">
          {error && <p className="form-error">{error}</p>}
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={() => void run(() => api('/newsletter/confirm', { method: 'POST', body: { token } }), { confirmed: true, active: true })}
          >
            {busy ? t('common.loading') : t('newsletter.confirm')}
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell back="/">
      <div className="auth-header">
        <h1>{t('newsletter.manageTitle')}</h1>
        <p className="muted">{t(subscription.active ? 'newsletter.manageActive' : 'newsletter.manageStopped', { email: subscription.email })}</p>
      </div>
      <div className="auth-form">
        <div className="field">
          <span className="field-label">{t('newsletter.frequency')}</span>
          <div className="segmented" role="group" aria-label={t('newsletter.frequency')}>
            {(['weekly', 'instant'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={subscription.active && subscription.frequency === value ? 'is-selected' : ''}
                aria-pressed={subscription.active && subscription.frequency === value}
                disabled={busy}
                onClick={() => void setFrequency(value)}
              >
                {t(`newsletter.${value}`)}
              </button>
            ))}
          </div>
          <span className="field-hint muted small">{t(`newsletter.${subscription.frequency}Hint`)}</span>
        </div>
        {error && <p className="form-error">{error}</p>}
        {saved && (
          <p className="form-ok small" role="status">
            {t(subscription.active ? 'newsletter.savedActive' : 'newsletter.savedStopped')}
          </p>
        )}
        {subscription.active ? (
          <button
            type="button"
            className="btn btn-secondary btn-block"
            disabled={busy}
            onClick={() => void run(() => api(`/newsletter/unsubscribe/${token}`, { method: 'POST' }), { active: false })}
          >
            {t('newsletter.unsubscribe')}
          </button>
        ) : (
          <p className="muted small">{t('newsletter.resubscribeHint')}</p>
        )}
      </div>
    </Shell>
  );
}
