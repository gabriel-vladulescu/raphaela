import { useState } from 'react';
import { useAdminI18n } from '@/admin/i18n';
import { Dialog, Field } from '@/admin/ui';
import { api } from '@/lib/api';

const DURATIONS = [1, 3, 7, 30, 90, null] as const;

/**
 * Suspends an account: for a while or until lifted, with a reason the person sees when they try to sign in. They're
 * signed out everywhere at once (server/src/lib/accounts.ts).
 */
export function SuspendDialog({ user, onClose, onDone }: { user: { id: number; name: string }; onClose: () => void; onDone: () => void }) {
  const { t, errorMessage } = useAdminI18n();
  const [days, setDays] = useState<number | null>(7);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api(`/admin/users/${user.id}/suspend`, { method: 'POST', body: { days, reason: reason.trim() || undefined } });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('suspend.title', { name: user.name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="adm-btn is-ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="adm-btn is-danger" onClick={() => void submit()} disabled={busy}>
            {busy ? t('common.loading') : t('suspend.submit')}
          </button>
        </>
      }
    >
      <p className="adm-muted">{t('suspend.body')}</p>
      <div className="adm-field">
        <span className="adm-field-label">{t('suspend.duration')}</span>
        <div className="adm-chips" role="radiogroup" aria-label={t('suspend.duration')}>
          {DURATIONS.map((value) => (
            <button key={String(value)} type="button" role="radio" aria-checked={days === value} className={`adm-chip${days === value ? ' is-active' : ''}`} onClick={() => setDays(value)}>
              {value === null ? t('suspend.forever') : t('suspend.days', { n: value })}
            </button>
          ))}
        </div>
      </div>
      <Field label={t('suspend.reason')} hint={t('suspend.reasonHint')}>
        <textarea className="adm-input" rows={3} maxLength={500} value={reason} placeholder={t('suspend.reasonPlaceholder')} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {error && <p className="adm-form-error">{error}</p>}
    </Dialog>
  );
}
