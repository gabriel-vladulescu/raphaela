import type { Pool, RowDataPacket } from 'mysql2/promise';
import { followingOn } from '@/lib/follows';
import { mailConfigured } from '@/lib/mail';
import { setupNeeded } from '@/lib/setup';

// Settings administrators change in the admin panel (Settings → General), kept in app_settings ('site', JSON).

export interface Announcement {
  enabled: boolean;
  /** One or two sentences, shown in a bar above every page. */
  text: string;
  /** An optional link at its end ("Read more"). */
  linkUrl: string;
  linkLabel: string;
  tone: 'info' | 'success' | 'warning';
}

export interface SiteSettings {
  /** Only accounts with a confirmed address can comment and reply (against spam from throwaway accounts). */
  commentsRequireVerifiedEmail: boolean;
  /** A new account's first comment waits for an administrator's approval (later ones don't). */
  firstCommentApproval: boolean;
  /** Words (or parts of words) a comment may not contain, one per entry; case and diacritics don't matter. */
  blockedWords: string[];
  /** What a comment with a blocked word gets: held for approval, or refused. */
  blockedWordsAction: 'hold' | 'block';
  /** Comments with links: allowed, held for approval, or refused. */
  links: 'allow' | 'hold' | 'block';
  /** The bar above every page. */
  announcement: Announcement;
  /** Readers can subscribe to new posts by email (needs the email server). */
  newsletterEnabled: boolean;
  /** Only administrators see the site; everyone else gets a "back soon" page. */
  maintenance: boolean;
  maintenanceMessage: string;
}

const DEFAULTS: SiteSettings = {
  commentsRequireVerifiedEmail: false,
  firstCommentApproval: false,
  blockedWords: [],
  blockedWordsAction: 'hold',
  links: 'allow',
  announcement: { enabled: false, text: '', linkUrl: '', linkLabel: '', tone: 'info' },
  newsletterEnabled: true,
  maintenance: false,
  maintenanceMessage: '',
};

let current: SiteSettings = DEFAULTS;

const merge = (saved: Partial<SiteSettings>): SiteSettings => ({
  ...DEFAULTS,
  ...saved,
  announcement: { ...DEFAULTS.announcement, ...(saved.announcement ?? {}) },
});

export async function loadSiteSettings(db: Pool) {
  const [rows] = await db.query<RowDataPacket[]>("SELECT value FROM app_settings WHERE name = 'site'");
  try {
    current = rows[0] ? merge(JSON.parse(rows[0].value as string) as Partial<SiteSettings>) : DEFAULTS;
  } catch {
    current = DEFAULTS;
  }
}

export const siteSettings = () => current;

export async function saveSiteSettings(db: Pool, next: SiteSettings) {
  const value = merge(next);
  await db.query("INSERT INTO app_settings (name, value) VALUES ('site', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [JSON.stringify(value)]);
  current = value;
  return value;
}

/** What every visitor's page needs to know (the announcement, whether the site is closed, the newsletter, following). */
export function publicSiteSettings() {
  const s = current;
  return {
    announcement: s.announcement.enabled && s.announcement.text.trim() ? s.announcement : null,
    maintenance: s.maintenance ? { message: s.maintenanceMessage } : null,
    // The signup box only where its emails can go out (without an SMTP server: hidden).
    newsletter: s.newsletterEnabled && mailConfigured(),
    commentsRequireVerifiedEmail: s.commentsRequireVerifiedEmail,
    /** Following authors: only with more than one (lib/follows.ts). */
    follow: followingOn(),
    /** A fresh copy that still needs its first administrator (lib/setup.ts). */
    setupNeeded: setupNeeded(),
  };
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const LINK = /(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|ro|net|org|info|io|ru|xyz|biz|top|site|online|shop|link|ly)\b/i;

/**
 * What the comment filters say about a comment: fine, held for approval (and why), or refused. Administrators' and
 * authors' comments aren't checked (routes/comments.ts).
 */
export function checkComment(body: string): { verdict: 'ok' } | { verdict: 'hold' | 'block'; reason: 'words' | 'links' } {
  const s = current;
  const text = fold(body);
  const word = s.blockedWords.map(fold).find((w) => w.trim() && text.includes(w.trim()));
  if (word) return { verdict: s.blockedWordsAction, reason: 'words' };
  if (s.links !== 'allow' && LINK.test(body)) return { verdict: s.links, reason: 'links' };
  return { verdict: 'ok' };
}
