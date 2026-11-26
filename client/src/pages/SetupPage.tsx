import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Sparkles } from 'lucide-react';
import { site } from '@/config';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { hideSplash } from '@/lib/splash';

/**
 * The first run (server/src/lib/setup.ts): a fresh copy of the blog, with no administrator yet, asks for its name and
 * its first administrator before anything else. The code is in the server's log, so only whoever runs the server can
 * finish it. Then the admin panel opens (a full reload: every page carries the site's name from the server).
 */
export function SetupPage() {
  const { t, lang, errorMessage } = useI18n();
  const [code, setCode] = useState('');
  const [identity, setIdentity] = useState({ name: site.name, description: site.description, company: site.company, defaultLanguage: lang });
  const [admin, setAdmin] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Opened at the home page, the splash waits for posts there; here there are none to wait for.
  useEffect(hideSplash, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/setup', { method: 'POST', body: { code: code.trim(), identity, admin: { ...admin, email: admin.email.trim() } } });
      window.location.assign('/admin');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="container auth-page setup-page">
      <div className="auth-card card">
        <div className="auth-header">
          <span className="invite-icon" aria-hidden="true">
            <Sparkles size={24} />
          </span>
          <h1>{t('setup.title')}</h1>
          <p className="muted">{t('setup.subtitle')}</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span className="field-label">{t('setup.code')}</span>
            <input
              className="input setup-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <span className="field-hint">{t('setup.codeHint')}</span>
          </label>

          <h2 className="setup-section">{t('setup.site')}</h2>
          <label className="field">
            <span className="field-label">{t('setup.siteName')}</span>
            <input className="input" value={identity.name} onChange={(e) => setIdentity({ ...identity, name: e.target.value })} required maxLength={60} />
          </label>
          <label className="field">
            <span className="field-label">{t('setup.description')}</span>
            <textarea
              className="input textarea"
              rows={2}
              value={identity.description}
              onChange={(e) => setIdentity({ ...identity, description: e.target.value })}
              maxLength={300}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('setup.company')}</span>
            <input className="input" value={identity.company} onChange={(e) => setIdentity({ ...identity, company: e.target.value })} maxLength={80} />
            <span className="field-hint">{t('setup.companyHint')}</span>
          </label>
          <div className="field">
            <span className="field-label">{t('setup.language')}</span>
            <div className="segmented" role="group" aria-label={t('setup.language')}>
              {(['ro', 'en'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={identity.defaultLanguage === value ? 'is-selected' : ''}
                  aria-pressed={identity.defaultLanguage === value}
                  onClick={() => setIdentity({ ...identity, defaultLanguage: value })}
                >
                  {value === 'ro' ? 'Română' : 'English'}
                </button>
              ))}
            </div>
          </div>

          <h2 className="setup-section">{t('setup.admin')}</h2>
          <label className="field">
            <span className="field-label">{t('auth.name')}</span>
            <input className="input" value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} required minLength={2} maxLength={80} autoComplete="name" />
          </label>
          <label className="field">
            <span className="field-label">{t('auth.email')}</span>
            <input className="input" type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} required maxLength={255} autoComplete="email" />
          </label>
          <label className="field">
            <span className="field-label">{t('auth.password')}</span>
            <input
              className="input"
              type="password"
              value={admin.password}
              placeholder={t('auth.passwordPlaceholder')}
              onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
              required
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? t('common.loading') : t('setup.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
