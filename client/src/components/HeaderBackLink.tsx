import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useHeaderSlot } from '@/lib/headerSlot';
import { useI18n } from '@/lib/i18n';

/**
 * "Back to posts" in the top bar's free space, left of its buttons (lib/headerSlot.ts). `to` and `label`: back to
 * another page instead (the administration's pages lead back to it).
 */
export function HeaderBackLink({ to = '/', label }: { to?: string; label?: string }) {
  const slot = useHeaderSlot();
  const { t } = useI18n();
  if (!slot) return null;
  return createPortal(
    <Link to={to} className="back-link">
      <ArrowLeft size={16} /> {label ?? t('post.backHome')}
    </Link>,
    slot,
  );
}
