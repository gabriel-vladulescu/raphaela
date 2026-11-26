import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { EmailOffModal, isEmailOff } from '@/components/EmailOffModal';
import { GoogleButton } from '@/components/GoogleButton';
import { TERMS_PATH } from '@/config';
import { useAuth } from '@/context/auth';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { showToast } from '@/lib/toast';

/** Why the account can't sign in: deleted (gone for good on `on`), or suspended (until a date, or until lifted). */
type Block = { kind: 'deleted'; on: string } | { kind: 'suspended'; until: string | null; reason: string | null };

/** From the sign-in's answer, or from the address Google sign-in came back to (/login?error=account_deleted&on=…). */
function blockOf(code: string | null, get: (key: string) => unknown): Block | null {
  const text = (key: string) => (typeof get(key) === 'string' ? (get(key) as string) : null);
  if (code === 'account_deleted') return { kind: 'deleted', on: text('purgeOn') ?? text('on') ?? '' };
  if (code === 'account_suspended') return { kind: 'suspended', until: text('until'), reason: text('reason') };
  return null;
}

/** A deleted or suspended account: what happened, and that support can help if it was a mistake. */
export function BlockedNotice({ block }: { block: Block }) {
  const { t, formatDate, formatDateTime } = useI18n();
  return (
    <div className="auth-blocked" role="alert">
      <CircleAlert size={20} aria-hidden="true" />
      <div>
        <strong>{t(block.kind === 'deleted' ? 'auth.deleted.title' : 'auth.suspended.title')}</strong>
        <p>
          {block.kind === 'deleted'
            ? // Past that day it waits for an administrator to delete it for good.
              block.on && new Date(block.on).getTime() > Date.now()
              ? t('auth.deleted.body', { date: formatDate(block.on) })
              : t('auth.deleted.pastBody')
            : block.until
              ? t('auth.suspended.until', { date: formatDateTime(block.until) })
              : t('auth.suspended.permanent')}
        </p>
        {block.kind === 'suspended' && block.reason && <p className="auth-blocked-reason">{t('auth.suspended.reason', { reason: block.reason })}</p>}
        <p>
          {t(block.kind === 'deleted' ? 'auth.deleted.mistake' : 'auth.suspended.mistake')} <Link to="/suport">{t('auth.blocked.support')}</Link>
        </p>
      </div>
    </div>
  );
}

/**
 * Shared by /login and /register: Google first and prominent, email/password below. Signing up asks for agreement to
 * the Terms and Conditions (a checkbox both ways of signing up need); signing in says that continuing means agreeing.
 */
export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, loading, refresh } = useAuth();
  const { t, lang, errorMessage } = useI18n();
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
  const [mailOff, setMailOff] = useState(false);
  const [error, setError] = useState(params.get('error') === 'google' ? t('auth.googleFailed') : '');
  const [block, setBlock] = useState<Block | null>(() => blockOf(params.get('error'), (key) => params.get(key)));
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
    setBlock(null);
    try {
      await api(isLogin ? '/auth/login' : '/auth/register', {
        method: 'POST',
        body: isLogin ? { email, password } : { name, email, password, acceptTerms: agreed, lang },
      });
      await refresh();
      if (!isLogin) showToast({ message: t('verify.sent', { email }) }, 10_000);
      navigate(next, { replace: true });
    } catch (err) {
      const blocked = err instanceof ApiError ? blockOf(err.code, (key) => err.data[key]) : null;
      if (blocked) setBlock(blocked);
      // Signing up emails the link that confirms the address: without the site's email, no account (Google still works).
      else if (isEmailOff(err)) setMailOff(true);
      else setError(errorMessage(err));
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

        {block && <BlockedNotice block={block} />}
        {mailOff && <EmailOffModal detail={t('mail.offSignup')} onClose={() => setMailOff(false)} />}

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
          {isLogin && (
            <Link to={email ? `/parola-uitata?email=${encodeURIComponent(email)}` : '/parola-uitata'} className="auth-forgot small">
              {t('auth.forgot')}
            </Link>
          )}
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
