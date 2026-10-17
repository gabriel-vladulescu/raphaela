import { Link } from 'react-router';
import { Bell } from 'lucide-react';
import { Popover } from '@/components/Popover';
import { PushToggles } from '@/components/PushToggles';
import { useAuth } from '@/context/auth';
import { useI18n } from '@/lib/i18n';
import { useUnread } from '@/lib/unread';

/**
 * The bell, top right. Signed in (any role): to the notifications page, with the unread count. Signed out: a small
 * panel to get new posts as notifications on this device (there's no notifications page without an account).
 */
export function NotificationBell() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const unread = useUnread(Boolean(user));
  if (loading) return null;

  if (!user) {
    return (
      <Popover label={t('nav.notifications')} button={<Bell size={19} />} buttonClassName="icon-btn bell-btn" panelClassName="bell-popover">
        {() => (
          <div className="bell-guest">
            <p className="popover-heading">{t('bell.guestTitle')}</p>
            <p className="muted small">{t('bell.guestText')}</p>
            <PushToggles mode="guest" />
          </div>
        )}
      </Popover>
    );
  }

  const label = unread > 0 ? t('nav.notificationsUnread', { n: unread }) : t('nav.notifications');
  return (
    <Link to="/notificari" className="icon-btn bell-btn" aria-label={label} title={label}>
      <Bell size={19} />
      {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}
