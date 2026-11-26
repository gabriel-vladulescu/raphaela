import { useState } from 'react';
import type { FormEvent } from 'react';
import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { showToast } from '@/lib/toast';

const REASONS = ['spam', 'harassment', 'hate', 'inappropriate', 'other'] as const;
type Reason = (typeof REASONS)[number];

/** Reports a comment to the administrators (the admin panel's moderation queue): why, and optionally more words. */
export function ReportCommentModal({ commentId, onClose }: { commentId: number; onClose: () => void }) {
  const { t, errorMessage } = useI18n();
  const [reason, setReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason) return setError(t('report.pickReason'));
    setSending(true);
    setError('');
    try {
      await api(`/comments/${commentId}/report`, { method: 'POST', body: { reason, details: details.trim() || undefined } });
      onClose();
      showToast({ message: t('report.thanks') });
    } catch (err) {
      setError(errorMessage(err));
      setSending(false);
    }
  }

  return (
    <Modal title={t('report.title')} onClose={onClose} sheet className="report-modal" head>
      <form className="modal-body" onSubmit={submit}>
        <p className="muted">{t('report.body')}</p>
        <div className="report-reasons" role="radiogroup" aria-label={t('report.reason')}>
          {REASONS.map((value) => (
            <label key={value} className={`report-reason${reason === value ? ' is-selected' : ''}`}>
              <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
              <span>
                <strong>{t(`report.reason.${value}` as MessageKey)}</strong>
                <span className="muted small">{t(`report.reasonHint.${value}` as MessageKey)}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="field">
          <span className="field-label">{t('report.details')}</span>
          <textarea className="input textarea" rows={3} maxLength={500} value={details} placeholder={t('report.detailsPlaceholder')} onChange={(e) => setDetails(e.target.value)} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-danger" disabled={sending}>
            {sending ? t('common.loading') : t('report.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
