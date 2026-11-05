import type { Pool, RowDataPacket } from 'mysql2/promise';
import { site as defaults } from '../../../site.config';

// Who the site is: its name, company, description, languages, contact and social links. site.config.ts holds the
// defaults (a fresh copy of the blog starts from them); administrators change them in the admin panel (Setări →
// Identitate), kept in app_settings ('identity', JSON). `site` is changed in place, so everything that reads it (search
// engine tags, share images, emails, the feed, the web app manifest) follows at once, and the browser gets it with
// each page (seo/html.ts: window.__SITE__).

export const SOCIAL = ['facebook', 'instagram', 'x', 'youtube', 'tiktok', 'pinterest', 'linkedin'] as const;
export type Social = (typeof SOCIAL)[number];

export interface SiteIdentity {
  name: string;
  /** Copyright holder: the footer ("© Raphaela.ro 2026"). */
  company: string;
  /** The home page's description in search results and link previews. */
  description: string;
  /** The posts' language (search engines), and its locale. */
  language: string;
  locale: string;
  timeZone: string;
  /** The interface's language for visitors who haven't picked one. */
  defaultLanguage: 'ro' | 'en';
  /** Shown in the footer and the emails, if set. */
  contactEmail: string;
  /** Links to the site's pages elsewhere (empty: not shown). */
  social: Record<Social, string>;
}

const BASE: SiteIdentity = {
  ...defaults,
  defaultLanguage: 'ro',
  contactEmail: '',
  social: Object.fromEntries(SOCIAL.map((key) => [key, ''])) as Record<Social, string>,
};

export const site: SiteIdentity = structuredClone(BASE);

const apply = (saved: Partial<SiteIdentity>) => {
  Object.assign(site, structuredClone(BASE), saved, { social: { ...BASE.social, ...(saved.social ?? {}) } });
};

export async function loadSiteIdentity(db: Pool) {
  const [rows] = await db.query<RowDataPacket[]>("SELECT value FROM app_settings WHERE name = 'identity'");
  try {
    apply(rows[0] ? (JSON.parse(rows[0].value as string) as Partial<SiteIdentity>) : {});
  } catch {
    apply({});
  }
}

export async function saveSiteIdentity(db: Pool, next: SiteIdentity) {
  await db.query("INSERT INTO app_settings (name, value) VALUES ('identity', ?) AS new ON DUPLICATE KEY UPDATE value = new.value", [JSON.stringify(next)]);
  apply(next);
  return site;
}

/** What the browser gets (all of it is public). */
export const publicIdentity = () => ({ ...site, social: { ...site.social } });
