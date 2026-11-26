import { useSyncExternalStore } from 'react';

// Adding the site to the home screen (it then opens like an app). Chrome, Edge and Samsung's browser have their own
// install dialog, offered through an event that comes once per page load, whenever the browser decides: it's kept
// here from the start, so both the invitation card (InstallPrompt) and the account sheet's button can open it.
// Safari on iPhones and iPads has no such dialog (any browser there adds through the Share menu); other browsers
// have it in their menu.

/** Chrome's and Edge's install event. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); // offered on the site's terms, not as the browser's own bar
  deferred = event as BeforeInstallPromptEvent;
  changed();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  justInstalled = true;
  changed();
});

/** Running as the installed app (opened from the home screen), or just installed. */
export const isInstalled = () =>
  justInstalled || window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** An iPhone or iPad (iPads say they're Macs, with a touch screen). */
export const isIOS = () => {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
};

/** Safari itself there (its Share button is in its bottom bar; other browsers' are elsewhere). */
export const isIOSSafari = () => isIOS() && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(navigator.userAgent);

/** How the site can be added here: already is, the browser's dialog, the Share menu (iPhone, iPad), or the menu. */
export type InstallWay = 'installed' | 'prompt' | 'ios' | 'menu';

export function installWay(): InstallWay {
  if (isInstalled()) return 'installed';
  if (deferred) return 'prompt';
  if (isIOS()) return 'ios';
  return 'menu';
}

/** installWay, kept up to date (the browser's dialog may become available later, or be used up). */
export function useInstallWay(): InstallWay {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, installWay);
}

/** Opens the browser's install dialog: whether it was accepted, or null when there's none to open. */
export async function promptInstall(): Promise<boolean | null> {
  const event = deferred;
  if (!event) return null;
  deferred = null; // each one opens once
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') justInstalled = true;
  changed();
  return outcome === 'accepted';
}
