import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { LoaderCircle, PenLine } from 'lucide-react';
import { TERMS_PATH } from '@/config';
import { useAuth } from '@/context/auth';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { showToast } from '@/lib/toast';
import { Outcome, Shell } from '@/pages/AccountLinkPages';

interface Invite {
  email: string;
  inviter: string | null;
  message: string | null;
  accountExists: boolean;
  alreadyAuthor: boolean;
  signedInAs: string | null;
}

/**
 * /invitatie?token=…: an administrator's invitation to write here (server/src/routes/invites.ts). With no account
 * yet: a name and a password make one, an author's. With an account: signed in with the invited address, one button
 * makes it an author's; otherwise, sign in with that address first.
 */
export function InvitePage() {
  const { t, errorMessage } = useI18n();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [invite, setInvite] = useState<Invite | null | 'invalid'>(token ? null : 'invalid');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api<{ invite: Invite }>(`/invites?token=${encodeURIComponent(token)}`)
      .then((data) => setInvite(data.invite))
      .catch(() => setInvite('invalid'));
  }, [token, user?.id]);

  async function accept(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/invites/accept', { method: 'POST', body: user ? { token } : { token, name: name.trim(), password, acceptTerms: agreed } });
      await refresh();
      showToast({ message: t('invite.welcome') });
      navigate(user ? `/${user.username}/articole/nou` : '/profil', { replace: true });
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'link_invalid') return setInvite('invalid');
      setError(errorMessage(err));
    }
  }

  if (invite === null) {
    return (
      <Shell back="/">
        <p className="auth-wait muted">
          <LoaderCircle size={18} className="spin" /> {t('verify.checking')}
        </p>
      </Shell>
    );
  }
  if (invite === 'invalid') {
    return (
      <Shell back="/">
        <Outcome tone="error" title={t('invite.invalidTitle')} body={t('invite.invalidBody')}>
          <Link to="/" className="btn btn-primary">
            {t('post.backHome')}
          </Link>
        </Outcome>
      </Shell>
    );
  }

  const login = `/login?next=${encodeURIComponent(`/invitatie?token=${token}`)}`;
  const header = (
    <div className="auth-header invite-header">
      <span className="invite-icon" aria-hidden="true">
        <PenLine size={24} />
      </span>
      <h1>{t('invite.title')}</h1>
      <p className="muted">{invite.inviter ? t('invite.byWhom', { name: invite.inviter }) : t('invite.subtitle')}</p>
      {invite.message && <blockquote className="invite-message">{invite.message}</blockquote>}
    </div>
  );

  // Signed in with another address: this one isn't for that account.
  if (user && user.email !== invite.email) {
    return (
      <Shell back="/">
        {header}
        <p className="invite-note">{t('invite.otherAccount', { email: invite.email, current: user.email })}</p>
      </Shell>
    );
  }

  if (user) {
    return (
      <Shell back="/">
        {header}
        {invite.alreadyAuthor ? (
          <p className="muted">{t('invite.alreadyAuthor')}</p>
        ) : (
          <div className="auth-form">
            <p className="muted">{t('invite.upgrade', { email: invite.email })}</p>
            {error && <p className="form-error">{error}</p>}
            <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void accept()}>
              {busy ? t('common.loading') : t('invite.accept')}
            </button>
          </div>
        )}
      </Shell>
    );
  }

  // An account with this address exists: sign in with it, then come back here.
  if (invite.accountExists) {
    return (
      <Shell back="/">
        {header}
        <p className="muted">{t('invite.signIn', { email: invite.email })}</p>
        <Link to={login} className="btn btn-primary btn-block">
          {t('auth.login.submit')}
        </Link>
      </Shell>
    );
  }

  return (
    <Shell back="/">
      {header}
      <form className="auth-form" onSubmit={accept}>
        <label className="field">
          <span className="field-label">{t('auth.email')}</span>
          <input className="input" type="email" value={invite.email} readOnly />
        </label>
        <label className="field">
          <span className="field-label">{t('auth.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" autoFocus />
        </label>
        <label className="field">
          <span className="field-label">{t('auth.password')}</span>
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
          />
        </label>
        <label className="check-field">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
          <span>
            {t('auth.terms.agree')}{' '}
            <Link to={TERMS_PATH} target="_blank" rel="noopener">
              {t('auth.terms.link')}
            </Link>
          </span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? t('common.loading') : t('invite.create')}
        </button>
        <p className="muted small">
          {t('invite.haveAccount')} <Link to={login}>{t('auth.login.submit')}</Link>
        </p>
      </form>
    </Shell>
  );
}
