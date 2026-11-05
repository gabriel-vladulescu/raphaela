import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Cookie, X } from 'lucide-react';
import { TERMS_PATH } from '@/config';
import { closeConsent, setConsent, useConsent } from '@/lib/consent';
import { useI18n } from '@/lib/i18n';

/**
 * The cookie banner, at the bottom of every page until the visitor chooses: statistics or only what's necessary
 * (lib/consent.ts). Nothing is measured before a choice. The footer's "Cookie-uri" link opens it again.
 */
export function ConsentBanner() {
  const { t } = useI18n();
  const { consent, open } = useConsent();
  const [custom, setCustom] = useState(false);
  const [stats, setStats] = useState(consent === 'stats');

  // Opened again: starts from the current choice.
  useEffect(() => {
    if (open) {
      setStats(consent === 'stats');
      setCustom(consent !== null);
    }
  }, [open, consent]);

  if (!open) return null;
  const reopened = consent !== null;

  return (
    <section className="consent" role="dialog" aria-modal="false" aria-labelledby="consent-title">
      <div className="consent-head">
        <Cookie size={20} aria-hidden="true" />
        <h2 id="consent-title">{t('consent.title')}</h2>
        {reopened && (
          <button type="button" className="icon-btn icon-btn-sm consent-close" aria-label={t('common.close')} onClick={closeConsent}>
            <X size={16} />
          </button>
        )}
      </div>
      <p className="consent-text">
        {t('consent.body')}{' '}
        <Link to={`${TERMS_PATH}#cookie-uri`}>{t('consent.more')}</Link>
      </p>

      {custom && (
        <div className="consent-options">
          <label className="consent-option is-locked">
            <span>
              <strong>{t('consent.necessary')}</strong>
              <span className="muted small">{t('consent.necessaryHint')}</span>
            </span>
            <input type="checkbox" role="switch" className="switch" checked disabled title={t('consent.always')} />
          </label>
          <label className="consent-option">
            <span>
              <strong>{t('consent.stats')}</strong>
              <span className="muted small">{t('consent.statsHint')}</span>
            </span>
            <input type="checkbox" role="switch" className="switch" checked={stats} onChange={(event) => setStats(event.target.checked)} />
          </label>
        </div>
      )}

      <div className="consent-actions">
        {custom ? (
          <button type="button" className="btn btn-primary" onClick={() => setConsent(stats ? 'stats' : 'necessary')}>
            {t('consent.save')}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => setConsent('stats')}>
            {t('consent.acceptAll')}
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => setConsent('necessary')}>
          {t('consent.necessaryOnly')}
        </button>
        {!custom && (
          <button type="button" className="text-btn consent-custom" onClick={() => setCustom(true)}>
            {t('consent.customize')}
          </button>
        )}
      </div>
    </section>
  );
}
