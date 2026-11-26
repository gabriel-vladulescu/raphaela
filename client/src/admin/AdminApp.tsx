import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  FileText,
  FolderTree,
  History,
  Images,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Mail,
  Maximize2,
  Menu,
  Minimize2,
  MessageSquare,
  Moon,
  Settings,
  ShieldAlert,
  Sun,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AdminBell } from '@/admin/AdminBell';
import { AdminContext } from '@/admin/context';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import type { Overview } from '@/admin/types';
import '@/admin/admin.css';
import { Avatar } from '@/components/Avatar';
import { site } from '@/config';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { LANGS } from '@/lib/i18n';
import { currentTheme } from '@/lib/theme';

/**
 * The admin panel (/admin/*): its own app inside the site, with its own look (admin.css), for administrators only.
 * A sidebar of sections, a top bar, and the page (a child route, main.tsx). Loaded on demand, so readers never
 * download it.
 */


interface NavItem {
  to: string;
  label: AdminKey;
  icon: LucideIcon;
  end?: boolean;
  badge?: (o: Overview) => number;
}

const NAV: { group: AdminKey; items: NavItem[] }[] = [
  {
    group: 'nav.main',
    items: [
      { to: '/admin', label: 'nav.dashboard', icon: LayoutDashboard, end: true },
      { to: '/admin/statistici', label: 'nav.stats', icon: BarChart3 },
    ],
  },
  {
    group: 'nav.content',
    items: [
      { to: '/admin/articole', label: 'nav.posts', icon: FileText },
      { to: '/admin/carti', label: 'nav.books', icon: BookOpen },
      { to: '/admin/categorii', label: 'nav.categories', icon: FolderTree },
      { to: '/admin/media', label: 'nav.media', icon: Images },
    ],
  },
  {
    group: 'nav.community',
    items: [
      { to: '/admin/comentarii', label: 'nav.comments', icon: MessageSquare, badge: (o) => o.reports.open + o.held },
      { to: '/admin/utilizatori', label: 'nav.users', icon: Users },
      { to: '/admin/newsletter', label: 'nav.newsletter', icon: Mail },
      { to: '/admin/suport', label: 'nav.support', icon: LifeBuoy, badge: (o) => o.tickets.unseen },
    ],
  },
  {
    group: 'nav.system',
    items: [
      { to: '/admin/setari', label: 'nav.settings', icon: Settings, badge: (o) => (o.mail.configured ? 0 : 1) },
      { to: '/admin/jurnal', label: 'nav.log', icon: History, badge: (o) => o.errors.unseen },
    ],
  },
];

type AdminTheme = 'light' | 'dark';
const THEME_KEY = 'adminTheme';
/** The content as wide as the window (else centred, at most 1440px). */
const WIDE_KEY = 'adminWide';

const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // kept for this visit only
  }
};

function initialTheme(): AdminTheme {
  const saved = stored(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return currentTheme() === 'light' ? 'light' : 'dark'; // follows the site's theme until changed here
}

export default function AdminApp() {
  const { user, loading, isOwner } = useAuth();
  const { t } = useAdminI18n();
  const location = useLocation();
  if (loading) return <div className="adm adm-boot">…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!isOwner) {
    return (
      <div className="adm adm-boot" data-adm-theme={initialTheme()}>
        <div className="adm-card adm-forbidden">
          <ShieldAlert size={28} aria-hidden="true" />
          <h1>{t('forbidden.title')}</h1>
          <p className="adm-muted">{t('forbidden.body')}</p>
          <Link to="/" className="adm-btn is-primary">
            {t('shell.toSite')}
          </Link>
        </div>
      </div>
    );
  }
  return <AdminShell />;
}

function AdminShell() {
  const { t, lang, setLang } = useAdminI18n();
  const { user, logout } = useAuth();
  const location = useLocation();
  const [theme, setTheme] = useState<AdminTheme>(initialTheme);
  const [wide, setWide] = useState(() => stored(WIDE_KEY) === '1');
  const [navOpen, setNavOpen] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);

  const refreshOverview = useCallback(() => {
    api<Overview>('/admin/overview')
      .then(setOverview)
      .catch(() => undefined);
  }, []);

  useEffect(refreshOverview, [refreshOverview]);
  // The drawer closes on navigation (phones).
  useEffect(() => setNavOpen(false), [location.pathname]);

  const current = NAV.flatMap((g) => g.items).find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)));
  useEffect(() => {
    document.title = `${current ? t(current.label) : t('nav.dashboard')} · ${t('shell.title')} · ${site.name}`;
  }, [current, t]);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    store(THEME_KEY, next);
  }

  function toggleWide() {
    setWide(!wide);
    store(WIDE_KEY, wide ? '0' : '1');
  }

  return (
    <AdminContext.Provider value={{ overview, refreshOverview }}>
      <div className={`adm${navOpen ? ' is-nav-open' : ''}${wide ? ' is-wide' : ''}`} data-adm-theme={theme}>
        <aside className="adm-sidebar" aria-label={t('shell.navigation')}>
          <div className="adm-brand">
            <img src={`/icons/favicon-64.png`} alt="" width={28} height={28} />
            <span>
              <strong>{site.name}</strong>
              <small>{t('shell.title')}</small>
            </span>
            <button type="button" className="adm-icon-btn adm-nav-close" aria-label={t('common.close')} onClick={() => setNavOpen(false)}>
              <X size={18} />
            </button>
          </div>
          <nav className="adm-nav">
            {NAV.map((group) => (
              <div key={group.group} className="adm-nav-group">
                <span className="adm-nav-title">{t(group.group)}</span>
                {group.items.map((item) => {
                  const count = overview && item.badge ? item.badge(overview) : 0;
                  return (
                    <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `adm-nav-link${isActive ? ' is-active' : ''}`}>
                      <item.icon size={17} aria-hidden="true" />
                      <span>{t(item.label)}</span>
                      {count > 0 && <span className="adm-nav-badge">{item.to === '/admin/setari' ? '!' : count}</span>}
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </nav>
          <Link to="/" className="adm-nav-link adm-nav-site">
            <ArrowUpRight size={17} aria-hidden="true" />
            <span>{t('shell.toSite')}</span>
          </Link>
        </aside>
        <button type="button" className="adm-scrim" aria-label={t('common.close')} tabIndex={-1} onClick={() => setNavOpen(false)} />

        <div className="adm-main">
          <header className="adm-topbar">
            <button type="button" className="adm-icon-btn adm-nav-toggle" aria-label={t('shell.menu')} onClick={() => setNavOpen(true)}>
              <Menu size={20} />
            </button>
            <div className="adm-crumbs">
              <span className="adm-muted">{t('shell.title')}</span>
              <span className="adm-muted" aria-hidden="true">
                /
              </span>
              <strong>{current ? t(current.label) : t('nav.dashboard')}</strong>
            </div>
            <div className="adm-topbar-actions">
              <div className="adm-seg" role="group" aria-label={t('shell.language')}>
                {LANGS.map((option) => (
                  <button key={option.code} type="button" className={lang === option.code ? 'is-active' : ''} aria-pressed={lang === option.code} onClick={() => setLang(option.code)}>
                    {option.code.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="adm-tools" role="group" aria-label={t('shell.view')}>
                <button
                  type="button"
                  className="adm-icon-btn adm-wide-toggle"
                  aria-pressed={wide}
                  aria-label={t(wide ? 'shell.narrow' : 'shell.wide')}
                  title={t(wide ? 'shell.narrow' : 'shell.wide')}
                  onClick={toggleWide}
                >
                  {wide ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                </button>
                <button type="button" className="adm-icon-btn" aria-label={t(theme === 'dark' ? 'shell.light' : 'shell.dark')} title={t(theme === 'dark' ? 'shell.light' : 'shell.dark')} onClick={toggleTheme}>
                  {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                </button>
              </div>
              <AdminBell />
              <div className="adm-me">
                <Avatar name={user!.name} picture={user!.picture} size={30} />
                <span className="adm-me-name">{user!.name}</span>
              </div>
              <button type="button" className="adm-icon-btn" aria-label={t('shell.signOut')} title={t('shell.signOut')} onClick={() => void logout()}>
                <LogOut size={18} />
              </button>
            </div>
          </header>

          <main className="adm-content">
            <Outlet />
          </main>
        </div>
      </div>
    </AdminContext.Provider>
  );
}
