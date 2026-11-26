import type { FastifyRequest } from 'fastify';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { site } from '@/lib/siteIdentity';
import { notifyViews } from '@/lib/notifications';

/**
 * What the statistics record besides page views. `share:<app>` is a pick in the share sheet. Recorded by the browser,
 * once the action has gone through, with how long the visitor had been reading the page.
 */
export const ACTIONS = [
  'like',
  'unlike',
  'save',
  'unsave',
  'comment',
  'reply',
  'react',
  'share',
  'share:whatsapp',
  'share:facebook',
  'share:instagram',
  'share:x',
  'share:telegram',
  'share:pinterest',
  'share:email',
  'share:copy',
  'share:native',
  'double_tap_like',
  'bar:comments',
  'bar:home',
  'bar:next',
  'bar:edit',
  'next_pill',
  'signup_nudge',
  'install_shown',
  'install_accepted',
  'install_dismissed',
] as const;
export type Action = (typeof ACTIONS)[number];

/** A day in the site's time zone ("2026-10-15"): statistics are per local day. */
export function siteDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: site.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** When a site-local day ("2026-10-15") starts, as a UTC instant (for filtering timestamp columns). */
export function siteDayStart(day: string): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, date);
  // The zone's offset then: the same instant written in the zone, read back as if it were UTC.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: site.timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(new Date(guess));
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const offset = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute')) - guess;
  return new Date(guess - offset);
}

/** The page, without the query string except a category filter (searches can hold personal text). */
export function normalizePath(path: string) {
  const url = new URL(path, 'http://x');
  const category = url.searchParams.get('category');
  return (url.pathname + (category ? `?category=${encodeURIComponent(category)}` : '')).slice(0, 255);
}

/** The other site a visit came from (its host), or null for direct visits and the site's own links. */
export function referrerHost(referrer: string | undefined, ownHost: string) {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    return host && host !== ownHost.replace(/^www\./, '') ? host.slice(0, 255) : null;
  } catch {
    return null;
  }
}

/** Visible, live posts only (a beacon can name any id). */
async function livePostId(db: Pool, postId: number | null | undefined) {
  if (!postId) return null;
  const [rows] = await db.execute<RowDataPacket[]>('SELECT id FROM posts WHERE id = ? AND deleted_at IS NULL', [postId]);
  return rows[0] ? (rows[0].id as number) : null;
}

/**
 * A page opened. One row per visitor, page and day: opening it again adds to `loads`. A post's first view of the day
 * by a visitor also counts on the post (posts.view_count). Returns whether it was a new view.
 */
export async function recordView(
  db: Pool,
  req: FastifyRequest,
  input: { path: string; postId?: number | null; referrer?: string; tablet?: boolean },
): Promise<boolean> {
  const visitor = req.visitor;
  if (visitor.bot) return false;
  const postId = await livePostId(db, input.postId);
  // Without consent to statistics nothing about the visitor is kept: a post only counts one more view (the browser
  // reports a post once per visit to it).
  if (!visitor.analytics || !visitor.fingerprint) {
    if (postId) await countPostView(db, postId);
    return postId !== null;
  }
  const device = input.tablet && visitor.device === 'desktop' ? 'tablet' : visitor.device; // iPads say they're Macs
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO page_views (day, path, post_id, visitor_id, fingerprint, user_id, referrer, device, first_at, last_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE loads = LEAST(page_views.loads + 1, 65535), last_at = VALUES(last_at),
                             user_id = COALESCE(page_views.user_id, VALUES(user_id))`,
    [
      siteDay(),
      normalizePath(input.path),
      postId,
      visitor.id,
      visitor.fingerprint,
      req.user?.id ?? null,
      referrerHost(input.referrer, String(req.headers.host ?? '').split(':')[0] ?? ''),
      device,
    ],
  );
  const isNew = result.affectedRows === 1;
  if (isNew && postId) await countPostView(db, postId);
  return isNew;
}

/** One more view on a post's counter. Milestones, or every N views: the author hears about it (as they chose,
 *  lib/notifications.ts). */
async function countPostView(db: Pool, postId: number) {
  await db.execute('UPDATE posts SET view_count = view_count + 1 WHERE id = ?', [postId]);
  const [[post]] = await db.execute<RowDataPacket[]>('SELECT view_count FROM posts WHERE id = ?', [postId]);
  void notifyViews(db, { postId, total: Number(post?.view_count ?? 0) });
}

/** Reading time on a page (active seconds since the last report) and how far into a post the visitor got (%). */
export async function addReadingTime(db: Pool, req: FastifyRequest, input: { path: string; seconds: number; scroll: number }) {
  const visitor = req.visitor;
  if (visitor.bot || !visitor.analytics) return;
  await db.execute(
    `UPDATE page_views SET active_seconds = active_seconds + ?, max_scroll = GREATEST(max_scroll, ?), last_at = UTC_TIMESTAMP()
      WHERE day = ? AND path = ? AND (visitor_id = ? OR fingerprint = ?)
      ORDER BY id LIMIT 1`,
    [
      Math.min(Math.max(Math.round(input.seconds), 0), 120),
      Math.min(Math.max(Math.round(input.scroll), 0), 100),
      siteDay(),
      normalizePath(input.path),
      visitor.id,
      visitor.fingerprint,
    ],
  );
}

/**
 * An action (see ACTIONS). One row per visitor, action, page and day; repeats add to `times`. Returns whether it was
 * the visitor's first of the day (a new row).
 */
export async function recordEvent(
  db: Pool,
  req: FastifyRequest,
  input: { action: Action; path: string; postId?: number | null; seconds?: number | null },
) {
  const visitor = req.visitor;
  if (visitor.bot || !visitor.analytics) return false;
  const postId = await livePostId(db, input.postId);
  const seconds = input.seconds == null ? null : Math.min(Math.max(Math.round(input.seconds), 0), 86_400);
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO events (day, action, path, post_id, visitor_id, fingerprint, user_id, first_seconds, first_at, last_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE times = events.times + 1, last_at = VALUES(last_at), user_id = COALESCE(events.user_id, VALUES(user_id))`,
    [siteDay(), input.action, normalizePath(input.path), postId, visitor.id, visitor.fingerprint, req.user?.id ?? null, seconds],
  );
  return result.affectedRows === 1;
}
