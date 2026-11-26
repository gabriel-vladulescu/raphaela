import { useEffect, useState } from 'react';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import type { ReadingSummary, StreakDay } from '@/lib/types';

// How far readers got in each post, for "continue reading", their journeys through the books and the streak of
// days they read. Signed in, it's kept on the server (server/src/routes/books.ts); a guest's stays in this browser
// and moves into their account when they sign in (ReadingSync).

const PROGRESS = 'reading.progress';
const DAYS = 'reading.days';
/** Read past this (percent), a text counts as read (as on the server). */
export const FINISHED_AT = 92;

interface LocalEntry {
  /** Percent, the furthest point reached. */
  p: number;
  at: string;
}

/** The device's date ("2026-11-24"): reading days follow the reader's own midnight. */
export function localDay(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // No storage (a private window): progress lasts until the page closes.
  }
}

const localProgress = () => {
  const value = readJson<Record<string, LocalEntry>>(PROGRESS, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
};
const localDays = () => {
  const value = readJson<string[]>(DAYS, []);
  return Array.isArray(value) ? value.filter((day) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) : [];
};

/** A guest's progress, as the server takes it. */
export function guestEntries() {
  return Object.entries(localProgress())
    .map(([id, entry]) => ({ postId: Number(id), progress: Math.min(100, Math.max(0, Number(entry.p) || 0)), at: String(entry.at) }))
    .filter((entry) => Number.isSafeInteger(entry.postId) && entry.postId > 0)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 300);
}

/** A guest's progress in some posts (the book page shows which chapters they read). */
export function guestProgressOf(ids: number[]): Record<number, number> {
  const all = localProgress();
  return Object.fromEntries(ids.filter((id) => all[id]).map((id) => [id, all[id]!.p]));
}

const listeners = new Set<() => void>();
/** Something changed (a page can refresh its picture of the reader). */
export const onReadingChange = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** How far into a post the reader got (percent); a fifth of a text makes today a reading day. */
export async function recordProgress(postId: number, progress: number, signedIn: boolean) {
  const value = Math.round(Math.max(0, Math.min(100, progress)));
  if (signedIn) {
    await api(`/reading/${postId}`, { method: 'PUT', body: { progress: value, day: localDay() } }).catch(() => undefined);
  } else {
    const all = localProgress();
    const before = all[postId]?.p ?? 0;
    all[postId] = { p: Math.max(before, value), at: new Date().toISOString() };
    // The most recent 300.
    const kept = Object.entries(all)
      .sort(([, a], [, b]) => b.at.localeCompare(a.at))
      .slice(0, 300);
    writeJson(PROGRESS, Object.fromEntries(kept));
    if (value >= 20) {
      const days = new Set(localDays());
      days.add(localDay());
      writeJson(DAYS, [...days].sort().slice(-400));
    }
  }
  listeners.forEach((listener) => listener());
}

/** The streak from a guest's reading days (as the server works it out for accounts). */
function localStreak(): ReadingSummary['streak'] {
  const days = new Set(localDays());
  const today = localDay();
  const shift = (date: Date, by: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + by);
    return next;
  };
  let cursor = days.has(today) ? new Date() : shift(new Date(), -1);
  let count = 0;
  while (days.has(localDay(cursor)) && count < 3650) {
    count++;
    cursor = shift(cursor, -1);
  }
  const now = new Date();
  const monday = shift(now, -((now.getDay() + 6) % 7));
  const week: StreakDay[] = Array.from({ length: 7 }, (_, index) => {
    const day = localDay(shift(monday, index));
    return { day, read: days.has(day), today: day === today, future: day > today };
  });
  return { days: count, readToday: days.has(today), week };
}

const EMPTY = (): ReadingSummary => ({ current: null, journeys: [], streak: localStreak() });

/** The reader's picture: what to read now, their journeys, their streak (null while it loads). */
export function useReadingSummary() {
  const { user, loading } = useAuth();
  const [summary, setSummary] = useState<ReadingSummary | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => onReadingChange(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    const entries = guestEntries();
    const request = user
      ? api<ReadingSummary>(`/reading?today=${localDay()}`)
      : entries.length
        ? api<ReadingSummary>('/reading/summary', { method: 'POST', body: { entries, days: localDays(), today: localDay() } })
        : Promise.resolve(EMPTY());
    request
      .then((data) => !cancelled && setSummary(data))
      .catch(() => !cancelled && setSummary(EMPTY()));
    return () => {
      cancelled = true;
    };
  }, [user?.id, loading, version]);

  return summary;
}

/** Brings a guest's progress into the account they signed in to (once), then forgets it here. */
export function ReadingSync() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    const entries = guestEntries();
    const days = localDays();
    if (!entries.length && !days.length) return;
    api('/reading/import', { method: 'POST', body: { entries, days } })
      .then(() => {
        try {
          localStorage.removeItem(PROGRESS);
          localStorage.removeItem(DAYS);
        } catch {
          // nothing kept anyway
        }
        listeners.forEach((listener) => listener());
      })
      .catch(() => undefined);
  }, [user?.id]);
  return null;
}
