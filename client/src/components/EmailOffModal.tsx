import type { ReactNode } from 'react';
import { AlertModal } from '@/components/Modal';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * The site can't send email: no SMTP server is set (server/src/lib/mail.ts), so whatever needed an email (signing up
 * with a password, a new password, a new address, the confirmation link again, the newsletter) was refused.
 */
export const isEmailOff = (err: unknown) => err instanceof ApiError && err.code === 'email_unavailable';

/**
 * Over the form, when what was asked needs an email: the site's email system is unavailable (in red), and what that
 * means here (`detail`; by default, that the email couldn't be sent). The form stays as it was, to try again later.
 */
export function EmailOffModal({ detail, onClose }: { detail?: ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  const message = (
    <>
      <strong className="email-off-lead">{t('mail.offLead')}</strong> {detail ?? t('mail.offBody')}
    </>
  );
  return <AlertModal title={t('mail.offTitle')} message={message} onClose={onClose} />;
}
