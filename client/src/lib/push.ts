import { api } from '@/lib/api';

/** What a device gets: new posts (anyone), and an author's notifications (`activity`, authors and owners). */
export interface PushChoices {
  newPosts: boolean;
  activity: boolean;
}

export type PushSupport = 'ok' | 'insecure' | 'ios-install' | 'unsupported';

/**
 * Whether this browser can get push notifications from the site. They need https (or localhost), a service worker
 * and the Push API; on iPhones and iPads only the installed app (home screen) has it.
 */
export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return 'insecure';
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ok';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return ios ? 'ios-install' : 'unsupported';
}

/** The server's VAPID key, as the Push API wants it. */
function keyBytes(base64url: string) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function subscription() {
  if (pushSupport() !== 'ok') return null;
  const registration = await navigator.serviceWorker.ready; // registered in main.tsx
  return registration.pushManager.getSubscription();
}

/** What this device gets now. */
export async function getPushChoices(): Promise<PushChoices> {
  const current = await subscription();
  if (!current) return { newPosts: false, activity: false };
  return api<PushChoices>('/push/subscription/state', { method: 'POST', body: { endpoint: current.endpoint } });
}

export class PushDenied extends Error {}

/**
 * Changes what this device gets. Turning something on asks for the browser's permission (so call it from a tap)
 * and subscribes; turning everything off unsubscribes.
 */
export async function setPushChoices(choices: PushChoices): Promise<PushChoices> {
  let current = await subscription();
  if (!choices.newPosts && !choices.activity) {
    if (current) {
      await api('/push/subscription', { method: 'POST', body: { subscription: current.toJSON(), newPosts: false, activity: false } });
      await current.unsubscribe();
    }
    return choices;
  }
  if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') throw new PushDenied();
  if (!current) {
    const { key } = await api<{ key: string }>('/push/key');
    const registration = await navigator.serviceWorker.ready;
    current = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  }
  return api<PushChoices>('/push/subscription', { method: 'POST', body: { subscription: current.toJSON(), ...choices } });
}
