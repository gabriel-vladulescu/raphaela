import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { GoogleButton } from '@/components/GoogleButton';
import { TERMS_PATH } from '@/config';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Shared by /login and /register: Google first and prominent, email/password below. Signing up asks for agreement to
 * the Terms and Conditions (a checkbox both ways of signing up need); signing in says that continuing means agreeing.
 */
export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, loading, refresh } = useAuth();
  const { t, errorMessage } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Only same-site paths: "/posts/x" yes, "//evil.com" or "/\evil.com" no.
  const requested = params.get('next') ?? '';
  const next = /^\/(?![/\\])/.test(requested) ? requested : '/';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [agreeError, setAgreeError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(params.get('error') === 'google' ? t('auth.googleFailed') : '');
  const agreeRef = useRef<HTMLInputElement>(null);

  if (!loading && user) return <Navigate to={next} replace />;

  const isLogin = mode === 'login';
  const other = isLogin ? '/register' : '/login';

  // Signing up without the box ticked: point at it instead.
  function needAgreement() {
    setAgreeError(true);
    agreeRef.current?.focus();
    agreeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!isLogin && !agreed) return needAgreement();
    setSubmitting(true);
    setError('');
    try {
      await api(isLogin ? '/auth/login' : '/auth/register', {
        method: 'POST',
        body: isLogin ? { email, password } : { name, email, password, acceptTerms: agreed },
      });
      await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  const termsLink = (
    <Link to={TERMS_PATH} target="_blank" rel="noopener">
      {t('auth.terms.link')}
    </Link>
  );

  return (
    <div className="container auth-page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} /> {t('post.backHome')}
      </Link>
      <div className="auth-card card">
        <div className="auth-header">
          <h1>{t(isLogin ? 'auth.login.title' : 'auth.register.title')}</h1>
          <p className="muted">{t(isLogin ? 'auth.login.subtitle' : 'auth.register.subtitle')}</p>
        </div>

        {!isLogin && (
          <div className={`auth-terms${agreeError && !agreed ? ' is-missing' : ''}`}>
            <label className="check-field">
              <input
                ref={agreeRef}
                type="checkbox"
                checked={agreed}
                aria-describedby={agreeError && !agreed ? 'terms-error' : undefined}
                onChange={(event) => {
                  setAgreed(event.target.checked);
                  if (event.target.checked) setAgreeError(false);
                }}
              />
              <span>
                {t('auth.terms.agree')} {termsLink}
              </span>
            </label>
            {agreeError && !agreed && (
              <p id="terms-error" className="form-error" role="alert">
                {t('auth.terms.required')}
              </p>
            )}
          </div>
        )}

        <div className="auth-google">
          <span className="auth-recommended">{t('auth.recommended')}</span>
          <GoogleButton
            next={next}
            terms
            onClick={(event) => {
              if (isLogin || agreed) return;
              event.preventDefault();
              needAgreement();
            }}
          />
          <p className="muted small">{t('auth.googleHint')}</p>
        </div>

        <div className="divider">
          <span>{t('auth.or')}</span>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {!isLogin && (
            <label className="field">
              <span className="field-label">{t('auth.name')}</span>
              <input
                className="input"
                value={name}
                placeholder={t('auth.name')}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={80}
                autoComplete="name"
              />
            </label>
          )}
          <label className="field">
            <span className="field-label">{t('auth.email')}</span>
            <input className="input" type="email" value={email} placeholder={t('auth.email')} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label className="field">
            <span className="field-label">{t('auth.password')}</span>
            <input
              className="input"
              type="password"
              value={password}
              placeholder={t(isLogin ? 'auth.password' : 'auth.passwordPlaceholder')}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
            {!isLogin && <span className="field-hint">{t('auth.passwordHint')}</span>}
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn-secondary btn-block" disabled={submitting}>
            {submitting ? t('common.loading') : t(isLogin ? 'auth.login.submit' : 'auth.register.submit')}
          </button>
        </form>

        {/* Google can also create an account from here. */}
        {isLogin && (
          <p className="auth-legal muted small">
            {t('auth.terms.implied')} {termsLink}.
          </p>
        )}

        <p className="auth-switch muted">
          {t(isLogin ? 'auth.login.switch' : 'auth.register.switch')}{' '}
          <Link to={next === '/' ? other : `${other}?next=${encodeURIComponent(next)}`}>
            {t(isLogin ? 'auth.login.switchLink' : 'auth.register.switchLink')}
          </Link>
        </p>
      </div>
    </div>
  );
}
