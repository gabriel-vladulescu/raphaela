import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface BandTab {
  key: string;
  label: ReactNode;
  /** A number after it (a pill). */
  count?: number;
  active: boolean;
  /** Where it leads (a page, a section), or what it does (a filter). */
  to?: string;
  onClick?: () => void;
}

/**
 * The top of an account's pages (Settings, Profile, Notifications, Support, Saved): one card, the title and the line
 * under it at the left, the page's actions at the right; under them, the page's own tabs (sections, filters), and on
 * a band of their own, its tools (the notifications' filters). Narrow: the actions take the width, under the title.
 */
export function PageBand({ title, line, actions, tabs, tabsLabel, tools }: {
  title: string;
  line?: ReactNode;
  actions?: ReactNode;
  tabs?: BandTab[];
  tabsLabel?: string;
  tools?: ReactNode;
}) {
  return (
    <section className="card page-band">
      <div className="page-band-top">
        <div className="page-band-text">
          <h1 className="page-band-title">{title}</h1>
          {line && <p className="page-band-line">{line}</p>}
        </div>
        {actions && <div className="page-band-actions">{actions}</div>}
      </div>
      {tabs && tabs.length > 0 && (
        <nav className="page-band-tabs" aria-label={tabsLabel ?? title}>
          {tabs.map((tab) => {
            const body = (
              <>
                {tab.label}
                {tab.count !== undefined && <span className="count-pill">{tab.count}</span>}
              </>
            );
            const className = `page-band-tab${tab.active ? ' is-active' : ''}`;
            return tab.to ? (
              <Link key={tab.key} to={tab.to} className={className} aria-current={tab.active ? 'page' : undefined}>
                {body}
              </Link>
            ) : (
              <button key={tab.key} type="button" className={className} aria-pressed={tab.active} onClick={tab.onClick}>
                {body}
              </button>
            );
          })}
        </nav>
      )}
      {tools && <div className="page-band-tools">{tools}</div>}
    </section>
  );
}
