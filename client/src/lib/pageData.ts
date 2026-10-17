import type { Post } from '@/lib/types';

// The server puts the data of the page being opened into the HTML (window.__PAGE_DATA__, next to the same content
// as plain HTML for search engines), so the app can show it at once instead of loading it first.
declare global {
  interface Window {
    __PAGE_DATA__?: { post?: Post };
  }
}

/** The post the page was opened with, if it's this one (the public version: the app still refreshes it). */
export function initialPost(slug: string): Post | null {
  const post = window.__PAGE_DATA__?.post;
  return post && post.slug === slug ? post : null;
}
