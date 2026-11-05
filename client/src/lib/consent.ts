import { useSyncExternalStore } from 'react';

/**
 * The cookie banner's choice: 'stats' (statistics allowed: the visitor cookie and the fingerprint the server works out,
 * server/src/lib/visitor.ts) or 'necessary' (only what the site needs to work). Kept in a cookie the server reads too,
 * for 6 months; then the banner asks again. Null: not chosen yet (the banner shows, and nothing is measured).
 */
export type Consent = 'stats' | 'necessary';

const COOKIE = 'consent';
const MAX_AGE = 182 * 24 * 60 * 60;
const listeners = new Set<() => void>();
/** Someone asked to change the choice (the footer's "Cookie-uri" link). */
let reopened = false;

function read(): Consent | null {
  const match = /(?:^|;\s*)consent=(stats|necessary)(?:;|$)/.exec(document.cookie);
  return (match?.[1] as Consent | undefined) ?? null;
}

let current: Consent | null = typeof document === 'undefined' ? null : read();
const emit = () => listeners.forEach((listener) => listener());

export const getConsent = () => current;
export const statsAllowed = () => current === 'stats';

export function setConsent(value: Consent) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  // From the next request on, the server measures (or stops measuring) accordingly.
  document.cookie = `${COOKIE}=${value}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  current = value;
  reopened = false;
  emit();
}

/** Shows the banner again, to change the choice. */
export function openConsent() {
  reopened = true;
  emit();
}

export function closeConsent() {
  reopened = false;
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The choice, and whether the banner should show (no choice yet, or reopened). */
export function useConsent() {
  const consent = useSyncExternalStore(subscribe, () => current, () => null);
  const open = useSyncExternalStore(subscribe, () => reopened || current === null, () => false);
  return { consent, open };
}
