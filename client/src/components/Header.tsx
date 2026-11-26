import { Link, NavLink } from 'react-router';
import { AccountButton } from '@/components/AccountSheet';
import { NotificationBell } from '@/components/NotificationBell';
import { SettingsPopover } from '@/components/SettingsPopover';
import { UserMenu } from '@/components/UserMenu';
import { site } from '@/config';
import { useI18n } from '@/lib/i18n';
import { NARROW, useMediaQuery } from '@/lib/useMediaQuery';

/** The site's sections: today (home), the books, the journal (the articles), the subjects. */
export function SiteNav() {
  const { t } = useI18n();
  return (
    <nav className="site-nav" aria-label={t('nav.sections')}>
      <NavLink to="/" end>
        {t('nav.today')}
      </NavLink>
      <NavLink to="/carti">{t('nav.books')}</NavLink>
      <NavLink to="/jurnal">{t('nav.journal')}</NavLink>
      <NavLink to="/subiecte">{t('nav.subjects')}</NavLink>
    </nav>
  );
}

/**
 * The top bar, a floating pill: the logo and the site's name (home), room for a page's own control (the journal's
 * search, a back link, on narrow screens; see headerSlot.ts), the sections (wide screens), then the notifications
 * bell, the settings cog and the account menu. On narrow screens (phones and tablets) the last two are one button,
 * opening the account sheet, and the sections are in the dock at the bottom (Dock.tsx).
 */
export function Header({ slotRef }: { slotRef?: (element: HTMLDivElement | null) => void }) {
  const narrow = useMediaQuery(NARROW);
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link to="/" className="brand" aria-label={site.name}>
          <img src="/icons/logo-480.webp" alt="" width="36" height="36" />
          <span className="brand-name">{site.name}</span>
        </Link>
        <div className="header-slot" ref={slotRef} />
        {!narrow && <SiteNav />}
        <NotificationBell />
        {narrow ? (
          <AccountButton />
        ) : (
          <>
            <SettingsPopover />
            <UserMenu />
          </>
        )}
      </div>
    </header>
  );
}
