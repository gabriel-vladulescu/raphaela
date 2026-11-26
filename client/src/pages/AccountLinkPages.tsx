import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, CircleCheck, CircleX, LoaderCircle, MailCheck } from 'lucide-react';
import { EmailOffModal, isEmailOff } from '@/components/EmailOffModal';
import { useAuth } from '@/context/auth';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { showToast } from '@/lib/toast';
import { BlockedNotice } from '@/pages/AuthPage';

// The pages the site's emails lead to (server/src/lib/emails.ts): a new password, and confirming an address.

/** Why an emailed link doesn't work, as the server says it (lib/accounts.ts): and, if it was stopped, by what. */
interface LinkProblem {
  error: string;
  reason?: string;
}
const STOPPED_BY = ['replaced', 'password_changed', 'address_changed', 'verified', 'cancelled', 'google', 'account_deleted'];

/** A link problem in a sentence. */
function useLinkProblem() {
  const { t } = useI18n();
  return (problem: LinkProblem) => {
    if (problem.error === 'link_used') return t('link.used');
    if (problem.error === 'link_too_old') return t('link.tooOld');
    if (problem.error === 'link_revoked') return t(`link.revoked.${STOPPED_BY.includes(problem.reason ?? '') ? problem.reason : 'other'}` as MessageKey);
    return t('link.invalid');
  };
}

const isLinkProblem = (err: unknown): err is ApiError => err instanceof ApiError && err.code.startsWith('link_');
const problemOf = (err: ApiError): LinkProblem => ({ error: err.code, reason: typeof err.data.reason === 'string' ? err.data.reason : undefined });

export function Shell({ children, back = '/login' }: { children: ReactNode; back?: string }) {
  const { t } = useI18n();
  return (
    <div className="container auth-page">
      <Link to={back} className="back-link">
        <ArrowLeft size={16} /> {t(back === '/login' ? 'auth.backToLogin' : 'post.backHome')}
      </Link>
      <div className="auth-card card">{children}</div>
    </div>
  );
}

/** An outcome: an icon, a title, a sentence, and what to do next. */
export function Outcome(props: { tone: 'ok' | 'error' | 'info'; title: string; body: ReactNode; children?: ReactNode }) {
  const Icon = props.tone === 'ok' ? CircleCheck : props.tone === 'error' ? CircleX : MailCheck;
  return (
    <div className={`auth-outcome is-${props.tone}`} role={props.tone === 'error' ? 'alert' : 'status'}>
      <Icon size={36} aria-hidden="true" />
      <h1>{props.title}</h1>
      <p className="muted">{props.body}</p>
      {props.children && <div className="auth-outcome-actions">{props.children}</div>}
    </div>
  );
}

/** /parola-uitata: the address to send a new-password link to. */
export function ForgotPasswordPage() {
  const { t, lang, errorMessage } = useI18n();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  /** The site's email isn't working: the link can't go (a dialog says so; the form stays). */
  const [mailOff, setMailOff] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState('sending');
    setError('');
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email: email.trim(), lang } });
      setState('sent');
    } catch (err) {
      if (isEmailOff(err)) setMailOff(true);
      else setError(errorMessage(err));
      setState('idle');
    }
  }

  if (state === 'sent') {
    return (
      <Shell>
        <Outcome tone="info" title={t('forgot.sentTitle')} body={t('forgot.sentBody', { email: email.trim() })}>
          <Link to="/login" className="btn btn-secondary">
            {t('auth.backToLogin')}
          </Link>
        </Outcome>
      </Shell>
    );
  }
  return (
    <Shell>
      <div className="auth-header">
        <h1>{t('forgot.title')}</h1>
        <p className="muted">{t('forgot.subtitle')}</p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">{t('auth.email')}</span>
          <input className="input" type="email" value={email} placeholder={t('auth.email')} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={state === 'sending'}>
          {state === 'sending' ? t('common.loading') : t('forgot.submit')}
        </button>
      </form>
      {mailOff && (
        <EmailOffModal
          detail={
            <>
              {t('mail.offForgot')} <Link to="/suport">{t('mail.offSupport')}</Link>
            </>
          }
          onClose={() => setMailOff(false)}
        />
      )}
    </Shell>
  );
}

/** /resetare-parola?token=…: the new password, from the emailed link. Signs in once it's set. */
export function ResetPasswordPage() {
  const { t, errorMessage } = useI18n();
  const describeProblem = useLinkProblem();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  /** null while it's being checked; then the link works (no problem), or why not. */
  const [problem, setProblem] = useState<LinkProblem | null | undefined>(token ? undefined : { error: 'link_invalid' });
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!token) return;
    api<{ valid: boolean; error?: string; reason?: string }>(`/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((result) => setProblem(result.valid ? null : { error: result.error ?? 'link_invalid', reason: result.reason }))
      .catch(() => setProblem({ error: 'link_invalid' }));
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== repeat) return setError(t('reset.mismatch'));
    setSaving(true);
    setError('');
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      await refresh();
      showToast({ message: t('reset.done') });
      navigate('/', { replace: true });
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError && (err.code === 'account_deleted' || err.code === 'account_suspended')) return setBlocked(err);
      if (isLinkProblem(err)) return setProblem(problemOf(err));
      setError(errorMessage(err));
    }
  }

  if (blocked) {
    const data = blocked.data;
    return (
      <Shell>
        <BlockedNotice
          block={
            blocked.code === 'account_deleted'
              ? { kind: 'deleted', on: String(data.purgeOn ?? '') }
              : { kind: 'suspended', until: (data.until as string | null) ?? null, reason: (data.reason as string | null) ?? null }
          }
        />
      </Shell>
    );
  }
  if (problem === undefined) {
    return (
      <Shell>
        <p className="auth-wait muted">
          <LoaderCircle size={18} className="spin" /> {t('common.loading')}
        </p>
      </Shell>
    );
  }
  if (problem) {
    return (
      <Shell>
        <Outcome tone="error" title={t('reset.invalidTitle')} body={`${describeProblem(problem)} ${t('reset.invalidBody')}`}>
          <Link to="/parola-uitata" className="btn btn-primary">
            {t('reset.again')}
          </Link>
        </Outcome>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="auth-header">
        <h1>{t('reset.title')}</h1>
        <p className="muted">{t('reset.subtitle')}</p>
      </div>
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">{t('reset.password')}</span>
          <input
            className="input"
            type="password"
            value={password}
            placeholder={t('auth.passwordPlaceholder')}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            maxLength={200}
            autoComplete="new-password"
            autoFocus
          />
        </label>
        <label className="field">
          <span className="field-label">{t('reset.repeat')}</span>
          <input
            className="input"
            type="password"
            value={repeat}
            placeholder={t('reset.repeat')}
            onChange={(e) => setRepeat(e.target.value)}
            required
            minLength={8}
            maxLength={200}
            autoComplete="new-password"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={saving}>
          {saving ? t('common.loading') : t('reset.submit')}
        </button>
      </form>
    </Shell>
  );
}

/** /confirmare-email?token=…: confirms the account's address, or a new one (which then becomes the account's). */
export function ConfirmEmailPage() {
  const { t, errorMessage } = useI18n();
  const describeProblem = useLinkProblem();
  const { user, refresh } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  // `already`: the link was opened before (by the person, or by their mail's link checker) and it's done.
  const [result, setResult] = useState<{ purpose: 'verify' | 'change'; email: string; already?: boolean } | { error: string; reason?: string } | null>(
    token ? null : { error: 'link_invalid' },
  );
  const started = useRef(false);

  useEffect(() => {
    // Once (a link works once; StrictMode runs effects twice in development).
    if (!token || started.current) return;
    started.current = true;
    api<{ purpose: 'verify' | 'change'; email: string; already?: boolean }>('/auth/verify-email', { method: 'POST', body: { token } })
      .then((done) => {
        setResult(done);
        void refresh();
      })
      .catch((err: unknown) => setResult(isLinkProblem(err) ? problemOf(err) : { error: err instanceof ApiError ? err.code : 'generic' }));
  }, [token, refresh]);

  const next = user ? (
    <Link to="/profil" className="btn btn-primary">
      {t('verify.toProfile')}
    </Link>
  ) : (
    <Link to="/login" className="btn btn-primary">
      {t('auth.login.submit')}
    </Link>
  );

  return (
    <Shell back="/">
      {result === null ? (
        <p className="auth-wait muted">
          <LoaderCircle size={18} className="spin" /> {t('verify.checking')}
        </p>
      ) : 'error' in result ? (
        <Outcome
          tone="error"
          title={t('verify.failedTitle')}
          body={
            result.error.startsWith('link_')
              ? `${describeProblem(result)}${result.reason === 'account_deleted' || result.reason === 'cancelled' ? '' : ` ${t('verify.invalidBody')}`}`
              : errorMessage(new ApiError(result.error, 400))
          }
        >
          {next}
        </Outcome>
      ) : (
        <Outcome
          tone="ok"
          title={t(result.purpose === 'change' ? 'verify.changedTitle' : 'verify.doneTitle')}
          body={t(
            result.already
              ? result.purpose === 'change'
                ? 'verify.alreadyChangedBody'
                : 'verify.alreadyBody'
              : result.purpose === 'change'
                ? 'verify.changedBody'
                : 'verify.doneBody',
            { email: result.email },
          )}
        >
          {next}
        </Outcome>
      )}
    </Shell>
  );
}
