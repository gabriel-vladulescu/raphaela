import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Check, Clock, KeyRound, Mail, TriangleAlert } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { EmailOffModal, isEmailOff } from '@/components/EmailOffModal';
import { GoogleLogo } from '@/components/GoogleButton';
import { AlertModal, ConfirmModal, Modal } from '@/components/Modal';
import { useAuth } from '@/context/auth';
import { api, ApiError, googleLinkUrl } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import type { User } from '@/lib/types';

type Dialog = 'email' | 'password' | 'unlink' | 'replace' | null;

/** The Google account picked to connect, when its address isn't the account's (server: routes/me.ts). */
interface PendingGoogle {
  email: string;
  name: string | null;
  picture: string | null;
}

/** How Google sign-in came back to the profile page (/profil?google=…, server: routes/auth.ts). */
const RETURNS: Record<string, { notice?: MessageKey; error?: MessageKey }> = {
  linked: { notice: 'account.googleLinked' },
  already: { notice: 'account.googleAlready' },
  google_taken: { error: 'error.google_taken' },
  email_in_use: { error: 'error.email_in_use' },
  error: { error: 'error.generic' },
};

/**
 * How the account signs in, on the profile page: its email (changing it disconnects Google, whose address is always
 * the account's), Google (connect one, another one, or disconnect it) and a password (set or change it). Each change
 * that could lock someone out, or that changes the email, says so in a dialog first.
 */
export function AccountCard() {
  const { t, lang, errorMessage } = useI18n();
  const { user, setUser } = useAuth();
  const me = user!;
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<{ key: MessageKey; vars?: Record<string, string> } | null>(null);
  const [resending, setResending] = useState(false);
  const [emailError, setEmailError] = useState('');
  /** The site's email isn't working: the confirmation link can't go again (a dialog says so). */
  const [mailOff, setMailOff] = useState(false);
  const [alert, setAlert] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState<PendingGoogle | null>(null);

  // Back from Google: say how it went, or ask to confirm the account picked (it changes the email).
  useEffect(() => {
    const outcome = params.get('google');
    if (!outcome) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('google');
        return next;
      },
      { replace: true },
    );
    if (outcome === 'confirm') {
      api<{ pending: PendingGoogle | null }>('/me/google/pending')
        .then((data) => (data.pending ? setPending(data.pending) : setAlert('error.link_expired')))
        .catch(() => setAlert('error.generic'));
      return;
    }
    const result = RETURNS[outcome];
    if (result?.notice) setNotice({ key: result.notice });
    if (result?.error) setAlert(result.error);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const done = (updated: User, message: MessageKey, vars?: Record<string, string>) => {
    setUser(updated);
    setDialog(null);
    setNotice({ key: message, vars });
  };

  // The link that confirms the address, again.
  async function resend() {
    setResending(true);
    setEmailError('');
    try {
      await api('/me/verify-email', { method: 'POST', body: { lang } });
      setNotice({ key: 'verify.sent', vars: { email: me.email } });
    } catch (err) {
      if (isEmailOff(err)) setMailOff(true);
      else setEmailError(err instanceof ApiError && err.code === 'rate_limited' ? t('verify.wait') : errorMessage(err));
    } finally {
      setResending(false);
    }
  }

  async function cancelPending() {
    setEmailError('');
    try {
      setUser((await api<{ user: User }>('/me/email/pending', { method: 'DELETE' })).user);
    } catch (err) {
      setEmailError(errorMessage(err));
    }
  }

  return (
    <section className="card profile-card signin-card">
      <h2 className="side-title">{t('account.title')}</h2>

      <div className="signin-row">
        <span className="signin-icon">
          <Mail size={18} />
        </span>
        <div className="signin-text">
          <strong>{t('profile.email')}</strong>
          <span className="signin-value">
            {me.email}{' '}
            {me.emailVerified ? (
              <span className="email-state is-ok" title={t('verify.confirmedHint')}>
                <Check size={12} aria-hidden="true" /> {t('verify.confirmed')}
              </span>
            ) : (
              <span className="email-state is-pending">{t('verify.unconfirmed')}</span>
            )}
          </span>
          {!me.emailVerified && (
            <span className="signin-sub">
              {t('verify.why')}{' '}
              <button type="button" className="link-btn" disabled={resending} onClick={() => void resend()}>
                {resending ? t('common.loading') : t('verify.resend')}
              </button>
            </span>
          )}
          {me.pendingEmail && (
            <span className="signin-sub">
              <Clock size={13} aria-hidden="true" /> {t('account.emailWaiting', { email: me.pendingEmail })}{' '}
              <button type="button" className="link-btn" onClick={() => void cancelPending()}>
                {t('account.emailWaitingCancel')}
              </button>
            </span>
          )}
          {emailError && <span className="form-error small">{emailError}</span>}
        </div>
        <div className="signin-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('email')}>
            {t('account.change')}
          </button>
        </div>
      </div>

      <div className="signin-row">
        <span className="signin-icon">
          <GoogleLogo size={18} />
        </span>
        <div className="signin-text">
          <strong>Google</strong>
          <span className="signin-value">
            {me.google ? (
              <>
                <Check size={14} className="signin-on" aria-hidden="true" /> {t('account.googleOn', { email: me.email })}
              </>
            ) : (
              t('account.googleOff')
            )}
          </span>
        </div>
        <div className="signin-actions">
          {me.google ? (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('replace')}>
                {t('account.googleReplace')}
              </button>
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setDialog('unlink')}>
                {t('account.googleUnlink')}
              </button>
            </>
          ) : (
            <a className="btn btn-secondary btn-sm" href={googleLinkUrl()}>
              <GoogleLogo size={16} /> {t('account.googleConnect')}
            </a>
          )}
        </div>
      </div>

      <div className="signin-row">
        <span className="signin-icon">
          <KeyRound size={18} />
        </span>
        <div className="signin-text">
          <strong>{t('auth.password')}</strong>
          <span className="signin-value">{t(me.hasPassword ? 'account.passwordSet' : 'account.passwordNone')}</span>
        </div>
        <div className="signin-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('password')}>
            {t(me.hasPassword ? 'account.passwordChange' : 'account.passwordAdd')}
          </button>
        </div>
      </div>

      {notice && (
        <p className="signin-notice" role="status">
          <Check size={16} aria-hidden="true" /> {t(notice.key, notice.vars)}
        </p>
      )}

      {dialog === 'email' && (
        <EmailDialog
          onCancel={() => setDialog(null)}
          onDone={(updated, pendingEmail) =>
            pendingEmail ? done(updated, 'account.emailPending', { email: pendingEmail }) : done(updated, 'account.emailChanged')
          }
        />
      )}
      {dialog === 'password' && <PasswordDialog onCancel={() => setDialog(null)} onDone={(updated) => done(updated, 'account.passwordSaved')} />}
      {dialog === 'unlink' && <UnlinkDialog onCancel={() => setDialog(null)} onDone={(updated) => done(updated, 'account.googleUnlinked')} />}
      {dialog === 'replace' && (
        <ConfirmModal
          title={t('account.replaceTitle')}
          message={t('account.replaceBody', { email: me.email })}
          confirmLabel={t('account.toGoogle')}
          onCancel={() => setDialog(null)}
          onConfirm={() => window.location.assign(googleLinkUrl())}
        />
      )}
      {pending && (
        <ConfirmGoogleDialog
          pending={pending}
          onCancel={() => {
            setPending(null);
            void api('/me/google/pending', { method: 'DELETE' }).catch(() => undefined);
          }}
          onDone={(updated) => {
            setPending(null);
            done(updated, 'account.googleLinked');
          }}
        />
      )}
      {alert && <AlertModal title={t('account.googleFailedTitle')} message={t(alert)} onClose={() => setAlert(null)} />}
      {mailOff && <EmailOffModal detail={t('mail.offVerify')} onClose={() => setMailOff(false)} />}
    </section>
  );
}

/** A dialog with a form: its fields, an error, and cancel / submit. */
function FormDialog(props: {
  title: string;
  submitLabel: string;
  danger?: boolean;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Modal title={props.title} onClose={props.busy ? undefined : props.onCancel} head>
      <form
        className="modal-body signin-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        {props.children}
        {props.error && <p className="form-error">{props.error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onCancel} disabled={props.busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`} disabled={props.busy}>
            {props.busy ? t('common.loading') : props.submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Sends a change, with the busy state and the error for a dialog. */
function useSubmit(onDone: (user: User) => void) {
  const { errorMessage } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Refused because the site's email isn't working (a new address needs its link): the dialog saying so. */
  const [mailOff, setMailOff] = useState(false);
  const submit = async (send: () => Promise<{ user: User }>) => {
    setBusy(true);
    setError('');
    try {
      onDone((await send()).user);
    } catch (err) {
      if (isEmailOff(err)) setMailOff(true);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, submit, mailOff, setMailOff };
}

/** The password that proves it's them (if the account has one), or the new one it needs (if it hasn't). */
function PasswordFields({ hasPassword, current, setCurrent, fresh, setFresh, freshHint }: {
  hasPassword: boolean;
  current: string;
  setCurrent: (value: string) => void;
  fresh: string;
  setFresh: (value: string) => void;
  freshHint: string;
}) {
  const { t } = useI18n();
  return hasPassword ? (
    <label className="field">
      <span className="field-label">{t('account.currentPassword')}</span>
      <input type="password" className="input" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} />
      <span className="field-hint">{t('account.currentPasswordHint')}</span>
    </label>
  ) : (
    <label className="field">
      <span className="field-label">{t('account.newPassword')}</span>
      <input type="password" className="input" autoComplete="new-password" required minLength={8} value={fresh} onChange={(event) => setFresh(event.target.value)} />
      <span className="field-hint">{freshHint}</span>
    </label>
  );
}

function EmailDialog({ onCancel, onDone }: { onCancel: () => void; onDone: (user: User, pendingEmail: string | null) => void }) {
  const { t, lang } = useI18n();
  const me = useAuth().user!;
  const [email, setEmail] = useState('');
  const [current, setCurrent] = useState('');
  const [fresh, setFresh] = useState('');
  // The server answers with the new address still waiting for its link (`pending`), or already changed.
  const pendingRef = useRef<string | null>(null);
  const { busy, error, setError, submit, mailOff, setMailOff } = useSubmit((user) => onDone(user, pendingRef.current));
  return (
    <FormDialog
      title={t('account.emailTitle')}
      submitLabel={t('account.emailSubmit')}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={() => {
        if (email.trim().toLowerCase() === me.email) return setError(t('account.emailSame'));
        void submit(async () => {
          const result = await api<{ user: User; pending: string | null }>('/me/email', {
            method: 'PUT',
            body: { email: email.trim(), lang, ...(me.hasPassword ? { currentPassword: current } : { newPassword: fresh }) },
          });
          pendingRef.current = result.pending;
          return result;
        });
      }}
    >
      {me.google && (
        <p className="field-warning">
          <TriangleAlert size={16} aria-hidden="true" /> {t('account.emailGoogleWarning', { email: me.email })}
        </p>
      )}
      <label className="field">
        <span className="field-label">{t('account.newEmail')}</span>
        <input type="email" className="input" autoComplete="email" required maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} autoFocus />
        <span className="field-hint">{t('account.emailCheck')}</span>
      </label>
      <PasswordFields
        hasPassword={me.hasPassword}
        current={current}
        setCurrent={setCurrent}
        fresh={fresh}
        setFresh={setFresh}
        freshHint={t('account.newPasswordNeeded')}
      />
      {mailOff && <EmailOffModal detail={t('mail.offEmailChange')} onClose={() => setMailOff(false)} />}
    </FormDialog>
  );
}

function PasswordDialog({ onCancel, onDone }: { onCancel: () => void; onDone: (user: User) => void }) {
  const { t } = useI18n();
  const me = useAuth().user!;
  const [current, setCurrent] = useState('');
  const [fresh, setFresh] = useState('');
  const { busy, error, submit } = useSubmit(onDone);
  return (
    <FormDialog
      title={t(me.hasPassword ? 'account.passwordChange' : 'account.passwordAdd')}
      submitLabel={t('account.passwordSubmit')}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={() =>
        void submit(() => api('/me/password', { method: 'PUT', body: { ...(me.hasPassword ? { currentPassword: current } : {}), newPassword: fresh } }))
      }
    >
      {me.hasPassword && (
        <label className="field">
          <span className="field-label">{t('account.currentPassword')}</span>
          <input type="password" className="input" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} autoFocus />
        </label>
      )}
      <label className="field">
        <span className="field-label">{t('account.newPassword')}</span>
        <input
          type="password"
          className="input"
          autoComplete="new-password"
          required
          minLength={8}
          value={fresh}
          onChange={(event) => setFresh(event.target.value)}
          autoFocus={!me.hasPassword}
        />
        <span className="field-hint">{t('auth.passwordHint')}</span>
      </label>
      {me.hasPassword && <p className="muted small">{t('account.passwordOthers')}</p>}
    </FormDialog>
  );
}

function UnlinkDialog({ onCancel, onDone }: { onCancel: () => void; onDone: (user: User) => void }) {
  const { t } = useI18n();
  const me = useAuth().user!;
  const [fresh, setFresh] = useState('');
  const { busy, error, submit } = useSubmit(onDone);
  return (
    <FormDialog
      title={t('account.unlinkTitle')}
      submitLabel={t('account.googleUnlink')}
      danger
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={() => void submit(() => api('/me/google/unlink', { method: 'POST', body: me.hasPassword ? {} : { newPassword: fresh } }))}
    >
      <p className="muted">{t('account.unlinkBody', { email: me.email })}</p>
      {!me.hasPassword && (
        <>
          <p className="field-warning">
            <TriangleAlert size={16} aria-hidden="true" /> {t('account.unlinkNoPassword')}
          </p>
          <label className="field">
            <span className="field-label">{t('account.newPassword')}</span>
            <input type="password" className="input" autoComplete="new-password" required minLength={8} value={fresh} onChange={(event) => setFresh(event.target.value)} autoFocus />
            <span className="field-hint">{t('auth.passwordHint')}</span>
          </label>
        </>
      )}
    </FormDialog>
  );
}

/** Back from Google with an account whose address isn't the account's: connecting it changes the email. */
function ConfirmGoogleDialog({ pending, onCancel, onDone }: { pending: PendingGoogle; onCancel: () => void; onDone: (user: User) => void }) {
  const { t } = useI18n();
  const me = useAuth().user!;
  const { busy, error, submit } = useSubmit(onDone);
  return (
    <FormDialog
      title={t('account.confirmTitle')}
      submitLabel={t('account.confirmSubmit')}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onSubmit={() => void submit(() => api('/me/google/confirm', { method: 'POST' }))}
    >
      <div className="signin-pick">
        <Avatar name={pending.name || pending.email} picture={pending.picture} size={44} />
        <div>
          {pending.name && <strong>{pending.name}</strong>}
          <span>{pending.email}</span>
        </div>
      </div>
      <p className="field-warning">
        <TriangleAlert size={16} aria-hidden="true" /> {t('account.confirmBody', { from: me.email, to: pending.email })}
      </p>
      {me.google && <p className="muted small">{t('account.confirmReplaces')}</p>}
    </FormDialog>
  );
}
