import type { ReactNode } from 'react';
import { Hammer } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/**
 * A part of a page that isn't ready yet: shown blurred behind a note saying so, and not usable (no clicks, no keyboard,
 * hidden from screen readers, which only get the note).
 */
export function InDevelopment({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="in-dev">
      <div className="in-dev-content" inert aria-hidden="true">
        {children}
      </div>
      <div className="in-dev-overlay">
        <span className="in-dev-badge" role="note">
          <Hammer size={15} aria-hidden="true" /> {t('common.inDevelopment')}
        </span>
      </div>
    </div>
  );
}
