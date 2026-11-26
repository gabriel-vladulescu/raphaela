import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * What a list or a section shows while it has nothing: an icon in an orbit, a title, a line on what will be there
 * (and when), and what one can do meanwhile (`children`: links or buttons). `compact`: inside a section of a page
 * (the home page's), not the page's whole content.
 */
export function EmptyState({ icon: Icon, title, text, compact = false, children }: { icon: LucideIcon; title: string; text: string; compact?: boolean; children?: ReactNode }) {
  return (
    <div className={`empty-panel${compact ? ' is-compact' : ''}`}>
      <span className="empty-panel-art" aria-hidden="true">
        <Icon size={compact ? 24 : 30} strokeWidth={1.6} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children && <div className="empty-panel-actions">{children}</div>}
    </div>
  );
}
