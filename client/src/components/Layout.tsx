import { useEffect, useState } from 'react';
import { Link, Outlet, ScrollRestoration, useLocation, useMatches } from 'react-router';
import { Construction, Mail, Megaphone, X } from 'lucide-react';
import { BrandIcon } from '@/components/BrandIcons';
import { ConsentBanner } from '@/components/ConsentBanner';
import { Header } from '@/components/Header';
import { InstallPrompt } from '@/components/InstallPrompt';
import { MidnightSky } from '@/components/MidnightSky';
import { NameConfirmModal } from '@/components/NameConfirmModal';
import { Toaster } from '@/components/Toaster';
import { site, siteSettings, SOCIAL, TERMS_PATH } from '@/config';
import { useAuth } from '@/context/auth';
import { trackPage } from '@/lib/analytics';
import { openConsent, useConsent } from '@/lib/consent';
import { HeaderSlotContext } from '@/lib/headerSlot';
import { useI18n } from '@/lib/i18n';
import { hideSplash } from '@/lib/splash';
import { useTheme } from '@/lib/theme';
import { SetupPage } from '@/pages/SetupPage';

/** Pages open while the site is closed for maintenance: signing in (administrators) and a forgotten password. */
const OPEN_IN_MAINTENANCE = /^\/(login|parola-uitata|resetare-parola)(\/|$)/;
const DISMISSED = 'announcement-dismissed';

const storedDismissal = () => {
  try {
    return localStorage.getItem(DISMISSED);
  } catch {
    return null;
  }
};

/** The administrators' announcement (admin panel → Setări), above the header. Closing it hides this text only. */
function AnnouncementBar() {
  const { t } = useI18n();
  const announcement = siteSettings.announcement;
  const key = announcement ? `${announcement.text}|${announcement.linkUrl}` : '';
  const [dismissed, setDismissed] = useState(() => storedDismissal() === key);
  if (!announcement || dismissed) return null;
  const external = /^https?:\/\//.test(announcement.linkUrl);
  return (
    <div className={`announcement is-${announcement.tone}`} role="region" aria-label={t('announcement.label')}>
      <div className="container announcement-inner">
        <Megaphone size={16} aria-hidden="true" />
        <p>
          {announcement.text}
          {announcement.linkUrl &&
            (external ? (
              <a href={announcement.linkUrl} target="_blank" rel="noopener">
                {announcement.linkLabel || t('announcement.more')}
              </a>
            ) : (
              <Link to={announcement.linkUrl}>{announcement.linkLabel || t('announcement.more')}</Link>
            ))}
        </p>
        <button
          type="button"
          className="icon-btn announcement-close"
          aria-label={t('common.close')}
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(DISMISSED, key);
            } catch {
              // a private window: it stays closed until the page reloads
            }
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

/** The site is closed for maintenance (admin panel → Setări): what visitors see instead of it. */
function MaintenancePage({ message }: { message: string }) {
  const { t } = useI18n();
  useEffect(hideSplash, []); // no posts to wait for
  return (
    <div className="container maintenance-page">
      <div className="card maintenance-card">
        <span className="maintenance-icon" aria-hidden="true">
          <Construction size={28} />
        </span>
        <h1>{t('maintenance.title')}</h1>
        <p className="muted">{message || t('maintenance.body', { name: site.name })}</p>
        {site.contactEmail && (
          <a href={`mailto:${site.contactEmail}`} className="btn btn-secondary btn-sm">
            <Mail size={15} /> {site.contactEmail}
          </a>
        )}
      </div>
    </div>
  );
}

export function Layout() {
  const { user, isOwner, loading } = useAuth();
  const { t } = useI18n();
  const theme = useTheme();
  const { pathname, search } = useLocation();
  const category = new URLSearchParams(search).get('category');
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const { consent } = useConsent();
  /** A route that only leads elsewhere (`handle.untracked`, e.g. /{username}): the page it leads to counts. */
  const untracked = useMatches().some((match) => (match.handle as { untracked?: boolean } | undefined)?.untracked);

  // A page view for the statistics. Posts report their own (with the post's id, once loaded); the work pages
  // (editor, admin, statistics, notifications, settings) aren't counted. Searches count as the home page.
  useEffect(() => {
    if (untracked || /^\/(posts|editor)\/|^\/(admin|statistici|notificari|setari)(\/|$)|^\/[^/]+\/articole\/./.test(pathname)) return;
    void trackPage(pathname + (category ? `?category=${encodeURIComponent(category)}` : ''));
    // Again once the visitor agrees on the banner: the page they're on counts too.
  }, [pathname, category, consent]);

  // A fresh copy with no administrator yet: the setup, before anything else.
  if (siteSettings.setupNeeded) {
    return (
      <>
        {theme === 'midnight' && <MidnightSky />}
        <main className="site-main">
          <SetupPage />
        </main>
        <Toaster />
      </>
    );
  }

  // Closed for maintenance: administrators still see the site (with a reminder), others a notice.
  const maintenance = siteSettings.maintenance;
  const closed = maintenance !== null && !isOwner && !OPEN_IN_MAINTENANCE.test(pathname);
  const socials = SOCIAL.filter((key) => site.social[key]);

  return (
    <>
      {theme === 'midnight' && <MidnightSky />}
      {maintenance && isOwner && (
        <div className="announcement is-warning">
          <div className="container announcement-inner">
            <Construction size={16} aria-hidden="true" />
            <p>
              {t('maintenance.ownerNote')} <Link to="/admin/setari">{t('maintenance.settings')}</Link>
            </p>
          </div>
        </div>
      )}
      {!closed && <AnnouncementBar />}
      <HeaderSlotContext.Provider value={headerSlot}>
        <Header slotRef={setHeaderSlot} />
        <main className="site-main">{closed ? loading ? null : <MaintenancePage message={maintenance.message} /> : <Outlet />}</main>
      </HeaderSlotContext.Provider>
      <footer className="site-footer">
        {(socials.length > 0 || site.contactEmail) && (
          <div className="container footer-social">
            {socials.map((key) => (
              <a key={key} href={site.social[key]} className="footer-social-link" target="_blank" rel="noopener me" aria-label={t(`social.${key}`)} title={t(`social.${key}`)}>
                <BrandIcon brand={key} size={18} />
              </a>
            ))}
            {site.contactEmail && (
              <a href={`mailto:${site.contactEmail}`} className="footer-social-link" aria-label={t('footer.contact')} title={site.contactEmail}>
                <Mail size={18} />
              </a>
            )}
          </div>
        )}
        <div className="container footer-inner">
          <span>
            © {site.company} {new Date().getFullYear()}
          </span>
          <span aria-hidden="true">·</span>
          <Link to={TERMS_PATH} className="footer-link">
            {t('footer.terms')}
          </Link>
          <span aria-hidden="true">·</span>
          <button type="button" className="footer-link" onClick={openConsent}>
            {t('footer.cookies')}
          </button>
        </div>
      </footer>
      {user && !user.nameConfirmed && <NameConfirmModal user={user} />}
      <Toaster />
      <ConsentBanner />
      <InstallPrompt />
      <ScrollRestoration />
    </>
  );
}
