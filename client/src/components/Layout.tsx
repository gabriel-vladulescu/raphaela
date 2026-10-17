import { useEffect, useState } from 'react';
import { Link, Outlet, ScrollRestoration, useLocation } from 'react-router';
import { Header } from '@/components/Header';
import { InstallPrompt } from '@/components/InstallPrompt';
import { MidnightSky } from '@/components/MidnightSky';
import { NameConfirmModal } from '@/components/NameConfirmModal';
import { Toaster } from '@/components/Toaster';
import { site, TERMS_PATH } from '@/config';
import { useAuth } from '@/context/auth';
import { trackPage } from '@/lib/analytics';
import { HeaderSlotContext } from '@/lib/headerSlot';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

export function Layout() {
  const { user } = useAuth();
  const { t } = useI18n();
  const theme = useTheme();
  const { pathname, search } = useLocation();
  const category = new URLSearchParams(search).get('category');
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);

  // A page view for the statistics. Posts report their own (with the post's id, once loaded); the work pages
  // (editor, admin, statistics, notifications, settings) aren't counted. Searches count as the home page.
  useEffect(() => {
    if (/^\/(posts|editor)\/|^\/(admin|statistici|notificari|setari)(\/|$)|^\/[^/]+\/articole\/./.test(pathname)) return;
    void trackPage(pathname + (category ? `?category=${encodeURIComponent(category)}` : ''));
  }, [pathname, category]);

  return (
    <>
      {theme === 'midnight' && <MidnightSky />}
      <HeaderSlotContext.Provider value={headerSlot}>
        <Header slotRef={setHeaderSlot} />
        <main className="site-main">
          <Outlet />
        </main>
      </HeaderSlotContext.Provider>
      <footer className="site-footer">
        <div className="container footer-inner">
          <span>
            © {site.company} {new Date().getFullYear()}
          </span>
          <span aria-hidden="true">·</span>
          <Link to={TERMS_PATH} className="footer-link">
            {t('footer.terms')}
          </Link>
        </div>
      </footer>
      {user && !user.nameConfirmed && <NameConfirmModal user={user} />}
      <Toaster />
      <InstallPrompt />
      <ScrollRestoration />
    </>
  );
}
