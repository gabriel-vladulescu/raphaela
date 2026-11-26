import { Link, useNavigate } from 'react-router';
import { BellRing, Bookmark, LayoutDashboard, LifeBuoy, LogOut, SlidersHorizontal, UserRound } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Popover } from '@/components/Popover';
import { useAuth } from '@/context/auth';
import { useI18n } from '@/lib/i18n';
import { openNewsletter } from '@/lib/newsletterSheet';
import { savedPath } from '@/lib/paths';

export function UserMenu() {
  const { user, logout, isOwner } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  // Guests sign in from the settings popover or a post's comment box.
  if (!user) return null;

  return (
    <Popover
      label={user.name}
      button={<Avatar name={user.name} picture={user.picture} size={34} />}
      buttonClassName="avatar-btn"
      panelClassName="user-popover"
    >
      {(close) => (
        <>
          <div className="user-card">
            <Avatar name={user.name} picture={user.picture} size={44} />
            <div className="user-card-text">
              <strong>{user.name}</strong>
              <span className="muted">{user.email}</span>
              <span className={`badge badge-${user.role}`}>{t(`role.${user.role}`)}</span>
            </div>
          </div>
          {/* Authors' pages live in the settings popover. */}
          <div className="menu-list" onClick={close}>
            <Link to="/profil" className="menu-item">
              <UserRound size={16} /> {t('nav.profile')}
            </Link>
            <Link to="/setari" className="menu-item">
              <SlidersHorizontal size={16} /> {t('nav.settings')}
            </Link>
            {/* Administrators: their pages are in the administration (and they don't save posts). */}
            {isOwner ? (
              <Link to="/admin" className="menu-item">
                <LayoutDashboard size={16} /> {t('nav.admin')}
              </Link>
            ) : (
              <>
                <Link to={savedPath()} className="menu-item">
                  <Bookmark size={16} /> {t('nav.saved')}
                </Link>
                <Link to="/suport" className="menu-item">
                  <LifeBuoy size={16} /> {t('nav.support')}
                </Link>
              </>
            )}
            <button type="button" className="menu-item" aria-haspopup="dialog" onClick={() => openNewsletter('menu')}>
              <BellRing size={16} /> {t('stay.title')}
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              <LogOut size={16} /> {t('nav.signOut')}
            </button>
          </div>
        </>
      )}
    </Popover>
  );
}
