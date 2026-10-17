import { useEffect, useSyncExternalStore } from 'react';
import { api } from '@/lib/api';

// How many notifications are unread, shared by the bell (header) and the notifications page.
let unread = 0;
const listeners = new Set<() => void>();

export function setUnread(count: number) {
  unread = count;
  listeners.forEach((listener) => listener());
}

export async function refreshUnread() {
  try {
    setUnread((await api<{ unread: number }>('/notifications/unread')).unread);
  } catch {
    // Offline or signed out: keep the last count.
  }
}

/** The unread count, checked every minute while the tab is visible and whenever it comes back into focus. */
export function useUnread(enabled: boolean) {
  const count = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => unread,
  );
  useEffect(() => {
    if (!enabled) return;
    void refreshUnread();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void refreshUnread(), 60_000);
    const onFocus = () => void refreshUnread();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled]);
  return enabled ? count : 0;
}
