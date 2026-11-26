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

/** The browser's permission (asked for: call it from a tap) and this device's subscription, made if needed. */
async function ensureSubscription() {
  if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') throw new PushDenied();
  const current = await subscription();
  if (current) return current;
  const { key } = await api<{ key: string }>('/push/key');
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
}

/**
 * Changes what this device gets. Turning something on asks for the browser's permission (so call it from a tap)
 * and subscribes; once the device gets nothing at all (no books either), it unsubscribes.
 */
export async function setPushChoices(choices: PushChoices): Promise<PushChoices> {
  if (!choices.newPosts && !choices.activity) {
    const current = await subscription();
    if (current) {
      const { kept } = await api<{ kept: boolean }>('/push/subscription', { method: 'POST', body: { subscription: current.toJSON(), newPosts: false, activity: false } });
      if (!kept) await current.unsubscribe();
    }
    return choices;
  }
  const current = await ensureSubscription();
  return api<PushChoices>('/push/subscription', { method: 'POST', body: { subscription: current.toJSON(), ...choices } });
}

/** Whether this device gets a book's new chapters ("Notify me"). */
export async function getBookPush(bookId: number) {
  const current = await subscription();
  if (!current) return false;
  return (await api<{ on: boolean }>(`/push/books/${bookId}/state`, { method: 'POST', body: { endpoint: current.endpoint } })).on;
}

/** A book's new chapters on this device: on (asks for permission: call it from a tap) or off. */
export async function setBookPush(bookId: number, on: boolean) {
  if (!on) {
    const current = await subscription();
    if (!current) return false;
    const { kept } = await api<{ kept: boolean }>(`/push/books/${bookId}`, { method: 'POST', body: { subscription: current.toJSON(), on: false } });
    if (!kept) await current.unsubscribe();
    return false;
  }
  const current = await ensureSubscription();
  await api(`/push/books/${bookId}`, { method: 'POST', body: { subscription: current.toJSON(), on: true } });
  return true;
}
