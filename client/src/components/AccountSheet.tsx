import { useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import {
  BarChart3,
  BellRing,
  BookOpen,
  Bookmark,
  ChevronDown,
  ChevronRight,
  EllipsisVertical,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Settings,
  Share,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { GoogleButton } from '@/components/GoogleButton';
import { Modal } from '@/components/Modal';
import { ThemePicker } from '@/components/Preferences';
import { site, TERMS_PATH } from '@/config';
import { useAuth } from '@/context/auth';
import { useReactions } from '@/context/reactions';
import { track } from '@/lib/analytics';
import { openConsent } from '@/lib/consent';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { isIOSSafari, promptInstall, useInstallWay } from '@/lib/install';
import { openNewsletter } from '@/lib/newsletterSheet';
import { myBooksPath } from '@/lib/books';
import { articlesPath, savedPath } from '@/lib/paths';
import { useTheme } from '@/lib/theme';

/** A step with a picture of the browser's button where it says {share} or {menu}. */
function Step({ text, token, icon }: { text: string; token: string; icon: ReactNode }) {
  const [before, after] = text.split(token);
  return (
    <li>
      {before}
      {after !== undefined && (
        <>
          {icon}
          {after}
        </>
      )}
    </li>
  );
}

/**
 * "Add to the home screen": the site on the home screen, opening like an app (lib/install.ts). Where the
 * browser has its own install dialog, it opens; elsewhere (iPhones, iPads, browsers without one) the steps show
 * under it. Not there once it's installed (or opened from the home screen).
 */
function InstallRow() {
  const { t } = useI18n();
  const way = useInstallWay();
  const [steps, setSteps] = useState(false);
  if (way === 'installed') return null;

  const add = async () => {
    if (way === 'prompt') {
      const accepted = await promptInstall();
      if (accepted !== null) {
        track(accepted ? 'install_accepted' : 'install_dismissed');
        return;
      }
    }
    setSteps((open) => !open);
  };

  const share = <Share size={15} className="install-share" aria-label={t('install.shareButton')} />;
  const menu = <EllipsisVertical size={15} className="install-share" aria-label={t('install.menuButton')} />;
  const lines: MessageKey[] =
    way === 'ios'
      ? [isIOSSafari() ? 'install.steps.iosSafari' : 'install.steps.iosOther', 'install.steps.ios2', 'install.steps.ios3']
      : ['install.steps.menu1', 'install.steps.menu2', 'install.steps.menu3'];

  return (
    <div className="account-card account-install">
      <button type="button" className="account-card-btn account-install-btn" onClick={() => void add()} aria-expanded={way === 'prompt' ? undefined : steps}>
        <img src="/icons/icon-192.png" alt="" width={40} height={40} />
        <span className="account-card-text">
          <strong>{t('install.menuTitle')}</strong>
          <span className="muted small">{t('install.body')}</span>
        </span>
        {way !== 'prompt' && <ChevronDown size={18} className={`account-card-chevron${steps ? ' is-open' : ''}`} aria-hidden="true" />}
      </button>
      {steps && way !== 'prompt' && (
        <ol className="account-install-steps">
          {lines.map((key) => (
            <Step key={key} text={t(key)} token={way === 'ios' ? '{share}' : '{menu}'} icon={way === 'ios' ? share : menu} />
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * "Stay in the loop": hearing of new posts on this device and by email (the newsletter), in one sheet. Narrow screens
 * have no newsletter box in the pages, so it's here (and offered now and then at the end of a post).
 */
function UpdatesRow({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <div className="account-card account-updates">
      <button type="button" className="account-card-btn account-updates-btn" aria-haspopup="dialog" onClick={onOpen}>
        <span className="account-updates-icon" aria-hidden="true">
          <BellRing size={20} />
        </span>
        <span className="account-card-text">
          <strong>{t('stay.title')}</strong>
          <span className="muted small">{t('stay.hint')}</span>
        </span>
        <ChevronRight size={18} className="account-card-chevron" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Narrow screens (phones and tablets): the account menu and the settings in one sheet that drops from the top
 * (swiped up to close). Who's signed in (or how to sign in), their pages, theme and language, and the footer's links
 * (phones have no footer). What to be notified of is on the Settings page (guests: the bell).
 */
function AccountSheet({ onClose }: { onClose: () => void }) {
  const { user, isOwner, canWrite, logout } = useAuth();
  const { bookmarks } = useReactions();
  const { t } = useI18n();
  const theme = useTheme();
  const navigate = useNavigate();

  // A link was followed: the sheet's job is done.
  const closeOnLink = (event: MouseEvent) => {
    if ((event.target as Element).closest('a')) onClose();
  };

  const link = (to: string, Icon: LucideIcon, label: string, extra?: ReactNode) => (
    <NavLink to={to} end className="menu-item">
      <Icon size={18} /> <span className="menu-item-text">{label}</span>
      {extra}
    </NavLink>
  );

  return (
    <Modal title={user?.name ?? t('settings.open')} onClose={onClose} closeOnBackdrop sheet="top" className="account-sheet">
      <div className="account-body" onClick={closeOnLink}>
        {user ? (
          <div className="account-user">
            <Avatar name={user.name} picture={user.picture} size={48} />
            <div className="user-card-text">
              <strong>{user.name}</strong>
              <span className="muted">{user.email}</span>
            </div>
            <span className={`badge badge-${user.role}`}>{t(`role.${user.role}`)}</span>
          </div>
        ) : (
          <div className="account-guest">
            <p className="muted small">{t('settings.signInHint')}</p>
            <GoogleButton size="medium" />
            <Link to="/login" className="small settings-other">
              {t('auth.otherOptions')}
            </Link>
          </div>
        )}

        {/* The pages, two to a row, and Sign out after them (in the last row's free cell, for writers). */}
        <div className="account-links">
          {user && link('/profil', UserRound, t('nav.profile'))}
          {user && link('/setari', SlidersHorizontal, t('nav.settings'))}
          {/* Administrators: their pages are in the administration (and they don't save posts). */}
          {isOwner ? (
            link('/admin', LayoutDashboard, t('nav.admin'))
          ) : (
            <>
              {link(savedPath(), Bookmark, t('nav.saved'), bookmarks.length > 0 && <span className="saved-pill-count">{bookmarks.length}</span>)}
              {canWrite && (
                <>
                  {link(articlesPath(), FileText, t('nav.manage'))}
                  {link(myBooksPath(), BookOpen, t('nav.myBooks'))}
                  {link('/statistici', BarChart3, t('nav.stats'))}
                </>
              )}
              {link('/suport', LifeBuoy, t('nav.support'))}
            </>
          )}
          {user && (
            <button
              type="button"
              className="menu-item menu-item-danger"
              onClick={async () => {
                onClose();
                await logout();
                navigate('/');
              }}
            >
              <LogOut size={18} /> <span className="menu-item-text">{t('nav.signOut')}</span>
            </button>
          )}
        </div>

        {/* (the language isn't here: it's changed in the settings menu on wide screens) */}
        <div className="account-settings">
          <div className="account-row">
            <span className="account-row-label">
              <span className="popover-heading">{t('settings.theme')}</span>
              <span className="account-row-value">{t(`theme.${theme}`)}</span>
            </span>
            <ThemePicker swatches />
          </div>
        </div>

        <UpdatesRow
          onOpen={() => {
            onClose();
            openNewsletter('menu');
          }}
        />
        <InstallRow />

        <div className="account-foot">
          <p className="account-legal">
            <span className="muted">
              © {site.company} {new Date().getFullYear()}
            </span>
            <span className="muted" aria-hidden="true">
              ·
            </span>
            <Link to={TERMS_PATH}>{t('footer.terms')}</Link>
            <span className="muted" aria-hidden="true">
              ·
            </span>
            <button type="button" className="link-btn" onClick={openConsent}>
              {t('footer.cookies')}
            </button>
          </p>
        </div>
      </div>
    </Modal>
  );
}

/** Narrow screens, top right: the profile picture (for guests, the settings cog) that opens the account sheet. */
export function AccountButton() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  // Until it's known who's here: the button's room, so the bar doesn't shift.
  if (loading) return <span className="account-btn-placeholder" aria-hidden="true" />;

  const label = user ? user.name : t('settings.open');
  return (
    <>
      <button
        type="button"
        className={`${user ? 'avatar-btn' : 'icon-btn'}${open ? ' is-active' : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {user ? <Avatar name={user.name} picture={user.picture} size={34} /> : <Settings size={19} />}
      </button>
      {open && <AccountSheet onClose={() => setOpen(false)} />}
    </>
  );
}
