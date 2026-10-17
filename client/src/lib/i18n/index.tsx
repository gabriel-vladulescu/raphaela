import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { en, ro } from '@/lib/i18n/messages';
import type { MessageKey } from '@/lib/i18n/messages';

export type Lang = 'ro' | 'en';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'ro', label: 'Română' },
  { code: 'en', label: 'English' },
];

const messages = { ro, en };
const locales: Record<Lang, string> = { ro: 'ro-RO', en: 'en-GB' };

function initialLang(): Lang {
  try {
    return localStorage.getItem('lang') === 'en' ? 'en' : 'ro';
  } catch {
    return 'ro';
  }
}

function useI18nValue() {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    document.documentElement.lang = next;
    try {
      localStorage.setItem('lang', next);
    } catch {
      // Not persisted (e.g. private mode); the choice still applies for this visit.
    }
  }, []);

  return useMemo(() => {
    const locale = locales[lang];

    /** Translates `key`, replacing `{name}` placeholders with `vars.name`. */
    const t = (key: MessageKey, vars?: Record<string, string | number>) =>
      // Falls back to Romanian, then the key itself: a missing string must never crash a page.
      (messages[lang][key] ?? ro[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => String(vars?.[name] ?? match));

    /** "1 răspuns / 3 răspunsuri / 20 de răspunsuri" in Romanian, "1 reply / 3 replies" in English. */
    const plural = (base: 'comments.replies' | 'post.views' | 'notif.comments' | 'notif.likes' | 'people.saved' | 'stats.visitorsN' | 'stats.comparedWith', n: number) => {
      const romanianDe = lang === 'ro' && n !== 0 && !(n % 100 >= 1 && n % 100 <= 19);
      const form = n === 1 ? 'one' : romanianDe ? 'other' : 'few';
      return t(`${base}.${form}`, { n: new Intl.NumberFormat(locale).format(n) });
    };

    /** Message for an API error code (or any thrown value). */
    const errorMessage = (err: unknown) => {
      const key = `error.${err instanceof ApiError ? err.code : 'generic'}` as MessageKey;
      return key in messages[lang] ? t(key) : t('error.generic');
    };

    const formatDate = (value: string | Date) =>
      new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value));

    const formatShortDate = (value: string | Date) =>
      new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));

    const formatDateTime = (value: string | Date) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

    const timeAgo = (value: string | Date) => {
      const seconds = (new Date(value).getTime() - Date.now()) / 1000;
      const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['year', 31536000],
        ['month', 2592000],
        ['week', 604800],
        ['day', 86400],
        ['hour', 3600],
        ['minute', 60],
      ];
      const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
      }
      return format.format(0, 'minute');
    };

    /** How long ago, compact as under a Facebook comment: "3 h", "2 z", "5 săpt." ("3h", "2d", "5w"). */
    const timeShort = (value: string | Date) => {
      const seconds = (Date.now() - new Date(value).getTime()) / 1000;
      const units: [Intl.NumberFormatOptions['unit'], number, 'short' | 'narrow'][] = [
        ['year', 31536000, 'short'],
        ['week', 604800, 'narrow'],
        ['day', 86400, 'narrow'],
        ['hour', 3600, 'narrow'],
        ['minute', 60, 'short'],
      ];
      for (const [unit, size, unitDisplay] of units) {
        if (seconds >= size) return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay }).format(Math.floor(seconds / size));
      }
      return t('time.now');
    };

    /** "5.062" in Romanian, "5,062" in English. */
    const formatNumber = (value: number) => new Intl.NumberFormat(locale).format(value);

    return { lang, locale, setLang, t, plural, errorMessage, formatDate, formatShortDate, formatDateTime, formatNumber, timeAgo, timeShort };
  }, [lang, setLang]);
}

type I18n = ReturnType<typeof useI18nValue>;
const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nContext.Provider value={useI18nValue()}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
