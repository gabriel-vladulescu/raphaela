import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { config } from '@/config';

const VISITOR_COOKIE = 'vid';
const TWO_YEARS_SECONDS = 2 * 365 * 24 * 60 * 60;

/** Crawlers, link previews, monitoring and scripted browsers: their visits and actions aren't counted. */
const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|bingpreview|facebookexternalhit|facebot|whatsapp|telegram|twitterbot|linkedin|embedly|pinterest|skype|vkshare|quora|lighthouse|pagespeed|gtmetrix|pingdom|uptime|headless|phantom|puppeteer|playwright|selenium|python|curl|wget|axios|node-fetch|undici|go-http|java\/|okhttp|libwww|httpclient/i;

export interface Visitor {
  /** A random id kept in a first-party cookie for two years. */
  id: string;
  /**
   * A salted hash of the IP address, browser and language. The same browser without its cookie (cleared, private
   * window) still hashes the same, so it isn't counted twice. Never stored in the clear.
   */
  fingerprint: string;
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

/** Who is making this request, as far as statistics and guest likes go. Sets the visitor cookie the first time. */
export function identify(req: FastifyRequest, reply: FastifyReply): Visitor {
  let id = req.cookies[VISITOR_COOKIE];
  if (!id || !/^[0-9a-f]{32}$/.test(id)) {
    id = crypto.randomBytes(16).toString('hex');
    reply.setCookie(VISITOR_COOKIE, id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: TWO_YEARS_SECONDS,
    });
  }
  const userAgent = req.headers['user-agent'] ?? '';
  const language = String(req.headers['accept-language'] ?? '').slice(0, 100);
  const fingerprint = crypto.createHmac('sha256', salt).update(`${req.ip}\n${userAgent}\n${language}`).digest('hex');
  return { id, fingerprint, device: deviceOf(userAgent), bot: !userAgent || BOT_UA.test(userAgent) };
}
