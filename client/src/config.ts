import { site as defaults } from '../../site.config';

// Who the site is (name, company, description, languages, contact, social links) and what every page needs (the
// announcement, maintenance, the newsletter, first-run setup). site.config.ts holds the defaults; the server puts the
// administrators' version into each page (window.__SITE__, server/src/seo/html.ts), read here as the app loads.

export const SOCIAL = ['facebook', 'instagram', 'x', 'youtube', 'tiktok', 'pinterest', 'linkedin'] as const;
export type Social = (typeof SOCIAL)[number];

export interface SiteIdentity {
  name: string;
  company: string;
  description: string;
  language: string;
  locale: string;
  timeZone: string;
  defaultLanguage: 'ro' | 'en';
  contactEmail: string;
  social: Record<Social, string>;
}

export interface Announcement {
  text: string;
  linkUrl: string;
  linkLabel: string;
  tone: 'info' | 'success' | 'warning';
}

export interface PublicSettings {
  announcement: Announcement | null;
  maintenance: { message: string } | null;
  newsletter: boolean;
  commentsRequireVerifiedEmail: boolean;
  /** Following authors (Follow, Settings' list): only where the site has more than one author. */
  follow: boolean;
  setupNeeded: boolean;
}

interface Injected {
  identity?: Partial<SiteIdentity>;
  settings?: Partial<PublicSettings>;
}

const injected: Injected = (typeof window !== 'undefined' && (window as unknown as { __SITE__?: Injected }).__SITE__) || {};

export const site: SiteIdentity = {
  ...defaults,
  defaultLanguage: 'ro',
  contactEmail: '',
  ...injected.identity,
  social: { ...(Object.fromEntries(SOCIAL.map((key) => [key, ''])) as Record<Social, string>), ...(injected.identity?.social ?? {}) },
};

export const siteSettings: PublicSettings = {
  announcement: null,
  maintenance: null,
  newsletter: true,
  commentsRequireVerifiedEmail: false,
  follow: false,
  setupNeeded: false,
  ...injected.settings,
};

/** The Terms and Conditions page. */
export const TERMS_PATH = '/termeni-si-conditii';
