import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useI18n } from '@/lib/i18n';

/**
 * A question about what was just done, asked where it was done (as the chapters' new order is, ChapterOrder): the page
 * blurred, the thing itself sharp where it is (`children`, drawn over `rect`), and under it (over it, when there's no
 * room) a bubble with the question, its tail pointing at `pointAt` (an x on the screen: what was picked). Escape, a tap
 * outside or "Cancel" leaves things as they were.
 */
export function ConfirmBubble(props: {
  rect: DOMRect;
  pointAt: number;
  icon: LucideIcon;
  title: string;
  detail: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { rect, pointAt, icon: Icon, title, detail, confirmLabel, busy = false, onConfirm, onCancel, className = '', children } = props;
  const { t } = useI18n();
  const width = Math.min(380, window.innerWidth - 32);
  const left = Math.max(16, Math.min(pointAt - width / 2, window.innerWidth - width - 16));
  const above = rect.bottom + 230 > window.innerHeight;
  const style: CSSProperties & Record<'--tail-x', string> = {
    width,
    left,
    '--tail-x': `${Math.max(22, Math.min(pointAt - left, width - 22))}px`,
    ...(above ? { bottom: window.innerHeight - rect.top + 14 } : { top: rect.bottom + 14 }),
  };
  return (
    <Modal title={title} onClose={onCancel} className={`order-confirm ${className}`}>
      <div className="order-confirm-layer" onClick={(event) => event.target === event.currentTarget && !busy && onCancel()}>
        <div className="order-confirm-row confirm-bubble-thing" style={{ top: rect.top, left: rect.left, width: rect.width }} aria-hidden="true">
          {children}
        </div>
        <div className={`order-bubble confirm-bubble${above ? ' is-above' : ''}`} style={style} role="alertdialog" aria-label={title} aria-describedby="confirm-bubble-question">
          <p id="confirm-bubble-question">
            <Icon size={18} aria-hidden="true" />
            <span>
              <strong>{title}</strong> {detail}
            </span>
          </p>
          <div className="order-bubble-actions">
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} autoFocus onClick={onConfirm}>
              {busy ? t('common.loading') : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
