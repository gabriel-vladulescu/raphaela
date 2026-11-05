import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { config } from '@/config';

const VISITOR_COOKIE = 'vid';
/** The visitor's choice on the cookie banner (client/src/lib/consent.ts writes it): 'stats' or 'necessary'. */
const CONSENT_COOKIE = 'consent';
/** At most 13 months, as recommended for audience measurement (the Terms say so). */
const VISITOR_COOKIE_SECONDS = 396 * 24 * 60 * 60;

/** Crawlers, link previews, monitoring and scripted browsers: their visits and actions aren't counted. */
const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|bingpreview|facebookexternalhit|facebot|whatsapp|telegram|twitterbot|linkedin|embedly|pinterest|skype|vkshare|quora|lighthouse|pagespeed|gtmetrix|pingdom|uptime|headless|phantom|puppeteer|playwright|selenium|python|curl|wget|axios|node-fetch|undici|go-http|java\/|okhttp|libwww|httpclient/i;

export interface Visitor {
  /**
   * A random id kept in a first-party cookie. With the visitor's consent to statistics it's set on the first visit;
   * without it, only when they do something that needs it (a like as a guest, keepVisitor), and otherwise it's a
   * throwaway id for this request.
   */
  id: string;
  /**
   * With consent to statistics: a salted hash of the IP address, browser and language. The same browser without its
   * cookie (cleared, private window) still hashes the same, so it isn't counted twice. Never stored in the clear.
   * Without consent: null (nothing is worked out from the device).
   */
  fingerprint: string | null;
  /** Agreed to statistics on the cookie banner. */
  analytics: boolean;
  /** The id is in the browser's cookie (or is being set now). */
  stored: boolean;
  device: 'mobile' | 'tablet' | 'desktop';
  bot: boolean;
}

let salt = '';

/** Loads the secret that salts fingerprints (created by migration 6). Call once at startup. */
export async function loadVisitorSalt(db: Pool) {
  const [rows] = await db.query<RowDataPacket[]>("SELECT value FROM app_settings WHERE name = 'analytics_salt'");
  salt = (rows[0]?.value as string | undefined) ?? '';
  if (!salt) throw new Error('analytics_salt is missing from app_settings');
}

function deviceOf(userAgent: string): Visitor['device'] {
  if (/iPad|Tablet|Android(?!.*Mobile)|Silk|Kindle/i.test(userAgent)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

function setVisitorCookie(reply: FastifyReply, id: string) {
  reply.setCookie(VISITOR_COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: VISITOR_COOKIE_SECONDS,
  });
}

/** Who is making this request, as far as statistics and guest likes go. */
export function identify(req: FastifyRequest, reply: FastifyReply): Visitor {
  const analytics = req.cookies[CONSENT_COOKIE] === 'stats';
  const saved = req.cookies[VISITOR_COOKIE];
  let id = saved && /^[0-9a-f]{32}$/.test(saved) ? saved : '';
  let stored = id !== '';
  if (!id) {
    id = crypto.randomBytes(16).toString('hex');
    if (analytics) {
      setVisitorCookie(reply, id);
      stored = true;
    }
  }
  const userAgent = req.headers['user-agent'] ?? '';
  const language = String(req.headers['accept-language'] ?? '').slice(0, 100);
  const fingerprint = analytics ? crypto.createHmac('sha256', salt).update(`${req.ip}\n${userAgent}\n${language}`).digest('hex') : null;
  return { id, fingerprint, analytics, stored, device: deviceOf(userAgent), bot: !userAgent || BOT_UA.test(userAgent) };
}

/** Keeps the visitor's id in its cookie, for something they asked for that needs it (a guest's like). */
export function keepVisitor(req: FastifyRequest, reply: FastifyReply) {
  if (req.visitor.stored) return;
  setVisitorCookie(reply, req.visitor.id);
  req.visitor.stored = true;
}
