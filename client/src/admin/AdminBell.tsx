import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Archive, Bell, CheckCheck, Clock, Flag, LifeBuoy, UserX } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { usePanelPosition, useOutside } from '@/admin/Dropdown';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import { api } from '@/lib/api';
import { setUnread } from '@/lib/unread';

interface AdminNotification {
  id: number;
  type: 'support' | 'report' | 'account_due' | 'comment_held' | 'cleanup_due' | string;
  times: number;
  detail: string | null;
  /** Old data: how many rows. */
  value: number | null;
  createdAt: string;
  read: boolean;
  post: { id: number; title: string; slug: string } | null;
  actor: { id: number; name: string } | null;
  ticket: { id: number; title: string; email: string } | null;
  account: { id: number; name: string } | null;
}

/** How often the count is checked while the panel is open in a tab. */
const POLL_MS = 60_000;

/**
 * The admin panel's bell: an administrator's notifications (new support tickets, reported comments, accounts to
 * delete for good; lib/notifications.ts on the server), the count of unread ones, and the latest in a panel. Opening
 * one marks it read and goes to its page.
 */
export function AdminBell() {
  const { t, timeAgo } = useAdminI18n();
  const { refreshOverview } = useAdmin();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnreadCount] = useState(0);
  const [items, setItems] = useState<AdminNotification[] | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const style = usePanelPosition(trigger, open, 'end', 380);
  useOutside([trigger, panel], open, () => setOpen(false));

  const count = useCallback(() => {
    api<{ unread: number }>('/notifications/unread')
      .then((result) => {
        setUnreadCount(result.unread);
        setUnread(result.unread);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    count();
    const timer = window.setInterval(count, POLL_MS);
    return () => window.clearInterval(timer);
  }, [count]);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    api<{ notifications: AdminNotification[]; unread: number }>('/notifications?limit=8')
      .then((result) => {
        setItems(result.notifications);
        setUnreadCount(result.unread);
      })
      .catch(() => setItems([]));
  }, [open]);

  function markRead(ids?: number[]) {
    setItems((list) => list?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) ?? null);
    api<{ unread: number }>('/notifications/read', { method: 'POST', body: ids ? { ids } : {} })
      .then((result) => {
        setUnreadCount(result.unread);
        setUnread(result.unread);
      })
      .catch(() => undefined);
  }

  const describe = (n: AdminNotification) => {
    switch (n.type) {
      case 'support':
        return t(n.detail === 'reply' ? 'bell.supportReply' : 'bell.support', { title: n.ticket?.title ?? '', email: n.ticket?.email ?? '' });
      case 'report':
        return n.times > 1
          ? t('bell.reportMany', { n: n.times, post: n.post?.title ?? '—' })
          : t('bell.report', { name: n.actor?.name ?? t('bell.someone'), reason: t(`reason.${n.detail ?? 'other'}` as AdminKey), post: n.post?.title ?? '—' });
      case 'account_due':
        return t('bell.accountDue', { name: n.account?.name ?? '' });
      case 'cleanup_due':
        return t('bell.cleanupDue', { n: n.value ?? 0 });
      case 'comment_held':
        return n.times > 1 ? t('bell.heldMany', { n: n.times, post: n.post?.title ?? '—' }) : t('bell.held', { name: n.actor?.name ?? t('bell.someone'), post: n.post?.title ?? '—' });
      default:
        return t('bell.other');
    }
  };
  const target = (n: AdminNotification) =>
    n.type === 'support'
      ? n.ticket
        ? `/admin/suport/${n.ticket.id}`
        : '/admin/suport'
      : n.type === 'report'
        ? '/admin/comentarii?filter=reported'
        : n.type === 'comment_held'
          ? '/admin/comentarii?filter=held'
        : n.type === 'account_due'
          ? `/admin/utilizatori?status=due${n.account ? `&id=${n.account.id}` : ''}`
          : n.type === 'cleanup_due'
            ? '/admin/jurnal?tab=cleanup'
            : '/admin';
  const Icon = (type: string) =>
    type === 'report' ? Flag : type === 'account_due' ? UserX : type === 'comment_held' ? Clock : type === 'cleanup_due' ? Archive : LifeBuoy;

  return (
    <div className="adm-bell">
      <button
        ref={trigger}
        type="button"
        className="adm-icon-btn"
        aria-label={unread ? t('bell.labelUnread', { n: unread }) : t('bell.label')}
        title={t('bell.label')}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Bell size={18} />
        {unread > 0 && <span className="adm-bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div ref={panel} className="adm-dd-panel adm-bell-panel" style={style}>
          <header className="adm-bell-head">
            <strong>{t('bell.label')}</strong>
            {unread > 0 && (
              <button type="button" className="adm-link-btn adm-small" onClick={() => markRead()}>
                <CheckCheck size={14} /> {t('bell.markAll')}
              </button>
            )}
          </header>
          {items === null ? (
            <p className="adm-dd-empty">{t('common.loading')}</p>
          ) : items.length === 0 ? (
            <p className="adm-dd-empty">{t('bell.none')}</p>
          ) : (
            <ul className="adm-bell-list">
              {items.map((n) => {
                const ItemIcon = Icon(n.type);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`adm-bell-item${n.read ? '' : ' is-unread'}`}
                      onClick={() => {
                        if (!n.read) markRead([n.id]);
                        setOpen(false);
                        refreshOverview();
                        navigate(target(n));
                      }}
                    >
                      <ItemIcon size={16} aria-hidden="true" />
                      <span>
                        <span className="adm-bell-text">{describe(n)}</span>
                        <span className="adm-muted adm-small">{timeAgo(n.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
