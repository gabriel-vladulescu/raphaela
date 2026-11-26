import { Link, NavLink } from 'react-router';
import { BarChart3, BellRing, BookOpen, FileText, LifeBuoy, Settings, SquarePen } from 'lucide-react';
import { GoogleButton } from '@/components/GoogleButton';
import { Popover } from '@/components/Popover';
import { LanguagePicker, ThemePicker } from '@/components/Preferences';
import { useAuth } from '@/context/auth';
import { useI18n } from '@/lib/i18n';
import { myBooksPath } from '@/lib/books';
import { openNewsletter } from '@/lib/newsletterSheet';
import { articlesPath, newArticlePath } from '@/lib/paths';

/** Top-right cog (wider screens; phones have the account sheet): authors' pages, theme, language, and (for guests)
 *  the way to sign in, support and "Stay in the loop" (signed in, those are in the account menu). */
export function SettingsPopover() {
  const { t } = useI18n();
  const { user, loading, isOwner, canWrite } = useAuth();

  return (
    <Popover label={t('settings.open')} button={<Settings size={19} />} panelClassName="settings-popover">
      {(close) => (
        <>
          {/* Authors' pages (administrators have theirs in the administration, from the account menu). */}
          {canWrite && !isOwner && (
            <>
              <p className="popover-heading">{t('settings.admin')}</p>
              <div className="menu-list" onClick={close}>
                <NavLink to={newArticlePath()} className="menu-item">
                  <SquarePen size={16} /> {t('nav.write')}
                </NavLink>
                <NavLink to={articlesPath()} end className="menu-item">
                  <FileText size={16} /> {t('nav.manage')}
                </NavLink>
                <NavLink to={myBooksPath()} className="menu-item">
                  <BookOpen size={16} /> {t('nav.myBooks')}
                </NavLink>
                <NavLink to="/statistici" className="menu-item">
                  <BarChart3 size={16} /> {t('nav.stats')}
                </NavLink>
              </div>
            </>
          )}

          <p className="popover-heading">{t('settings.theme')}</p>
          <ThemePicker />

          <p className="popover-heading">{t('settings.language')}</p>
          <LanguagePicker />

          {!loading && !user && (
            <div className="settings-account">
              <p className="popover-heading">{t('settings.account')}</p>
              <p className="muted small">{t('settings.signInHint')}</p>
              <GoogleButton size="medium" />
              <Link to="/login" className="small settings-other" onClick={close}>
                {t('auth.otherOptions')}
              </Link>
              <Link to="/suport" className="menu-item" onClick={close}>
                <LifeBuoy size={16} /> {t('nav.support')}
              </Link>
              <button
                type="button"
                className="menu-item"
                aria-haspopup="dialog"
                onClick={() => {
                  close();
                  openNewsletter('menu');
                }}
              >
                <BellRing size={16} /> {t('stay.title')}
              </button>
            </div>
          )}

        </>
      )}
    </Popover>
  );
}
