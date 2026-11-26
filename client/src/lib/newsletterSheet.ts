import { useSyncExternalStore } from 'react';
import { api } from '@/lib/api';

// The newsletter's sheet (NewsletterSheet, in the layout). On narrow screens the pages have no newsletter box: the
// account menu opens the sheet any time, and now and then it's offered at the end of a post. "Notify me" at the end
// of an unfinished book opens it for that book (on this device, by email, or both). What the offer needs is kept in
// this browser: the posts read to the end, how many times it was offered and when, and whether it was subscribed to
// from here.

/** A book whose new chapters someone wants to hear about. */
export interface NotifyBook {
  id: number;
  title: string;
}

/** What's open: the newsletter (from the menu, or offered at the end of a post), or a book's "Notify me". */
export type NewsletterSheetState = { way: 'menu' | 'offer' } | { way: 'book'; book: NotifyBook };

let current: NewsletterSheetState | null = null;
const listeners = new Set<() => void>();
const set = (state: NewsletterSheetState | null) => {
  current = state;
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const openNewsletter = (way: 'menu' | 'offer' = 'menu') => set({ way });
export const openBookNotify = (book: NotifyBook) => set({ way: 'book', book });
export const closeNewsletter = () => set(null);
/** The sheet's state: what's open, or null. */
export const useNewsletterSheet = () => useSyncExternalStore(subscribe, () => current);

const FINISHED = 'newsletter.finished';
const OFFERS = 'newsletter.offers';
const OFFERED_AT = 'newsletter.offeredAt';
const SUBSCRIBED = 'newsletter.subscribed';

/** Offered from the second post read to the end, */
const FIRST_AFTER = 2;
/** not again for three weeks after that, */
const PAUSE_MS = 21 * 24 * 60 * 60 * 1000;
/** and three times at most (the account menu has it any time after). */
const MAX_OFFERS = 3;

function read<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // No storage (a private window): it's offered no more than once a visit (current stays set while it's open).
  }
}

/** Subscribed from this browser (any of the newsletter's forms): not offered again. */
export const markSubscribed = () => write(SUBSCRIBED, true);

/** A post was read to the end: remembered (the latest 20), as the offer counts them. */
export function finishedReading(postId: number) {
  const ids = read<number[]>(FINISHED, []);
  if (!ids.includes(postId)) write(FINISHED, [...ids, postId].slice(-20));
}

/** Whether it's time to offer it: a second post read, three weeks since the last offer, not three offers yet. */
function due() {
  if (read(SUBSCRIBED, false)) return false;
  if (read<number[]>(FINISHED, []).length < FIRST_AFTER) return false;
  if (read(OFFERS, 0) >= MAX_OFFERS) return false;
  return Date.now() - read(OFFERED_AT, 0) >= PAUSE_MS;
}

/**
 * At the end of a post (narrow screens): offers the newsletter when it's due, unless something else is on screen
 * (a dialog, the install card) or the account already gets it. Counted as offered once shown, however it's closed.
 */
export async function offerNewsletter(signedIn: boolean) {
  if (current || !due()) return;
  if (document.querySelector('dialog[open], .install-card')) return;
  if (signedIn) {
    const reply = await api<{ subscription: { active: boolean } | null }>('/me/newsletter').catch(() => null);
    if (!reply || reply.subscription?.active) return;
  }
  if (current || document.querySelector('dialog[open]')) return;
  write(OFFERS, read(OFFERS, 0) + 1);
  write(OFFERED_AT, Date.now());
  set({ way: 'offer' });
}
