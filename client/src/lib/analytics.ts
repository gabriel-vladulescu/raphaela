/**
 * Statistics: which page is being read, for how long, how far into a post, and what readers do there. Reading time
 * is active time: the tab is visible and the reader did something (scrolled, touched, typed) in the last 45 seconds.
 * The server keeps one row per visitor, page and day (server/src/lib/analytics.ts). Automated browsers aren't counted.
 */

/** Mirrors ACTIONS in server/src/lib/analytics.ts. */
export type Action =
  | 'like'
  | 'unlike'
  | 'save'
  | 'unsave'
  | 'comment'
  | 'reply'
  | 'react'
  | 'share'
  | `share:${'whatsapp' | 'facebook' | 'instagram' | 'x' | 'telegram' | 'pinterest' | 'email' | 'copy' | 'native'}`
  | 'double_tap_like'
  | 'bar:comments'
  | 'bar:home'
  | 'bar:next'
  | 'bar:edit'
  | 'next_pill'
  | 'signup_nudge'
  | 'install_shown'
  | 'install_accepted'
  | 'install_dismissed';

const IDLE_MS = 45_000;
const REPORT_MS = 15_000;

interface Page {
  path: string;
  postId: number | null;
  activeMs: number;
  reportedMs: number;
  /** How much of the post the reader has had on screen, in %. */
  scroll: number;
  reportedScroll: number;
}

let page: Page | null = null;
let lastTick = 0;
let lastActivity = 0;
let landing = true; // the first page of the visit carries the referrer
let listening = false;
const automated = typeof navigator !== 'undefined' && navigator.webdriver === true;

function post(url: string, body: unknown) {
  if (automated) return Promise.resolve(null);
  return fetch(`/api${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true })
    .then((response) => (response.status === 200 ? response.json() : null))
    .catch(() => null);
}

/** For reports that need no answer: a beacon still goes out while the page is closing (sent as text/plain JSON). */
function beacon(url: string, body: unknown) {
  if (automated) return;
  if (!navigator.sendBeacon?.(`/api${url}`, JSON.stringify(body))) void post(url, body);
}

/** Adds the time since the last tick, if the reader was active (gaps over 2s, e.g. a sleeping phone, don't count). */
function tick() {
  const now = performance.now();
  if (page && document.visibilityState === 'visible' && now - lastActivity < IDLE_MS) page.activeMs += Math.min(now - lastTick, 2000);
  lastTick = now;
}

function report() {
  if (!page) return;
  tick();
  const seconds = Math.floor((page.activeMs - page.reportedMs) / 1000);
  if (seconds < 1 && page.scroll <= page.reportedScroll) return;
  page.reportedMs += seconds * 1000;
  page.reportedScroll = page.scroll;
  beacon('/track/time', { path: page.path, seconds, scroll: page.scroll });
}

function listen() {
  listening = true;
  const active = () => {
    tick();
    lastActivity = performance.now();
  };
  for (const type of ['scroll', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(type, active, { passive: true, capture: true });
  }
  let lastMove = 0;
  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.timeStamp - lastMove > 1000) {
        lastMove = event.timeStamp;
        active();
      }
    },
    { passive: true },
  );
  setInterval(tick, 1000);
  setInterval(report, REPORT_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') report();
    else lastTick = lastActivity = performance.now();
  });
  window.addEventListener('pagehide', report);
}

/** iPads report a desktop browser; a touch screen on a "Mac" gives them away. */
const isTablet = () => /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;

/**
 * A page was opened (posts pass their id). Reports the previous page's last seconds first. For posts, resolves to
 * the post's view count, this view included.
 */
export async function trackPage(path: string, postId: number | null = null): Promise<number | null> {
  if (!listening) listen();
  report();
  page = { path, postId, activeMs: 0, reportedMs: 0, scroll: 0, reportedScroll: 0 };
  lastTick = lastActivity = performance.now();
  const referrer = landing && document.referrer ? document.referrer : undefined;
  landing = false;
  const result = (await post('/track/view', { path, postId, referrer, tablet: isTablet(), automated })) as { views?: number | null } | null;
  return result?.views ?? null;
}

/** How much of the post the reader has seen (%); only ever grows. */
export function setReadProgress(percent: number) {
  if (page) page.scroll = Math.max(page.scroll, Math.min(100, Math.round(percent)));
}

/** Active seconds on the current page so far. */
export function readSeconds() {
  tick();
  return page ? Math.round(page.activeMs / 1000) : 0;
}

/** Records an action on the current page, with how long the reader had been on it. */
export function track(action: Action, postId?: number | null) {
  if (!page) return;
  beacon('/track/event', { action, path: page.path, postId: postId ?? page.postId, seconds: readSeconds() });
}

/** A short buzz for likes and saves (phones that allow it: Android; iPhones ignore it). */
export function buzz() {
  if (window.matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(12);
}
