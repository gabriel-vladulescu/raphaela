import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from '@/components/Avatar';
import { Modal } from '@/components/Modal';
import { TERMS_PATH } from '@/config';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { User } from '@/lib/types';

/**
 * After the first Google sign-in: keep the name from Google, or choose another one. An account made anywhere but the
 * register page (which asks before going to Google) also agrees to the Terms and Conditions here.
 */
export function NameConfirmModal({ user }: { user: User }) {
  const { setUser, logout } = useAuth();
  const { t, errorMessage } = useI18n();
  const [name, setName] = useState(user.name);
  const [agreed, setAgreed] = useState(false);
  const [agreeError, setAgreeError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const agreeRef = useRef<HTMLInputElement>(null);
  const changed = name.trim() !== user.name;
  const needsTerms = !user.termsAccepted;

  async function confirm(chosen: string) {
    if (needsTerms && !agreed) {
      setAgreeError(true);
      agreeRef.current?.focus();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data = await api<{ user: User }>('/me', { method: 'PATCH', body: { name: chosen, ...(needsTerms && { acceptTerms: true }) } });
      setUser(data.user);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal title={t('nameModal.title')} head>
      <form
        className="modal-body name-modal"
        onSubmit={(event) => {
          event.preventDefault();
          void confirm(changed ? name.trim() : user.name);
        }}
      >
        <Avatar name={name.trim() || user.name} picture={user.picture} size={64} />
        <p className="muted">{t('nameModal.body')}</p>
        <label className="field">
          <span className="field-label">{t('nameModal.label')}</span>
          <input className="input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        {needsTerms && (
          <div className={`auth-terms${agreeError && !agreed ? ' is-missing' : ''}`}>
            <label className="check-field">
              <input
                ref={agreeRef}
                type="checkbox"
                checked={agreed}
                aria-describedby={agreeError && !agreed ? 'name-modal-terms-error' : undefined}
                onChange={(event) => setAgreed(event.target.checked)}
              />
              <span>
                {t('auth.terms.agree')}{' '}
                <Link to={TERMS_PATH} target="_blank" rel="noopener">
                  {t('auth.terms.link')}
                </Link>
              </span>
            </label>
            {agreeError && !agreed && (
              <p id="name-modal-terms-error" className="form-error" role="alert">
                {t('nameModal.terms')}
              </p>
            )}
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          {changed ? (
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setName(user.name)}>
              {t('common.cancel')}
            </button>
          ) : (
            // Not agreeing: the way out is signing out (the account stays, and asks again next time).
            needsTerms && (
              <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => void logout()}>
                {t('nav.signOut')}
              </button>
            )
          )}
          <button type="submit" className="btn btn-primary" disabled={saving || name.trim().length < 2}>
            {changed ? t('nameModal.save') : t('nameModal.keep')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
