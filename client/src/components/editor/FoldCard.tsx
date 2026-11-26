import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * A settings card whose title opens and closes it (closed at first): folded, it says in a line what's in it
 * (`summary`), so it needn't be opened to know. The editor's advanced settings.
 */
export function FoldCard({ title, summary, children, className = '' }: { title: string; summary?: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className={`card side-card fold-card${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <button type="button" className="fold-card-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="fold-card-text">
          <span className="side-title">{title}</span>
          {!open && summary && <span className="fold-card-summary">{summary}</span>}
        </span>
        <ChevronDown size={18} className="fold-card-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className="fold-card-body">
          {children}
        </div>
      )}
    </section>
  );
}
