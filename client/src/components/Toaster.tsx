import { Link } from 'react-router';
import { X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { hideToast, useToast } from '@/lib/toast';

/** The current toast (lib/toast.ts), at the bottom of the screen; above the post page's bar on phones. */
export function Toaster() {
  const { t } = useI18n();
  const toast = useToast();
  if (!toast) return null;
  return (
    <div key={toast.id} className="toast" role="status">
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <Link
          to={toast.action.to}
          className="toast-action"
          onClick={() => {
            toast.action?.onClick?.();
            hideToast();
          }}
        >
          {toast.action.label}
        </Link>
      )}
      <button type="button" className="toast-close" aria-label={t('common.close')} onClick={hideToast}>
        <X size={16} />
      </button>
    </div>
  );
}
