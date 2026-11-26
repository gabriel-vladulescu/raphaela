import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import sharp from 'sharp';
import { config } from '@/config';
import { site } from '@/lib/siteIdentity';

// Fetching an image from another site, for a writer who picked it in an image library or pasted its address (the
// banner's "Search images"): only from the public internet. Never this machine, the local network or a reserved
// range, checked on the address actually connected to (a name that resolves somewhere private is refused, even if
// it changes between two lookups), on every redirect too. At most MAX_BYTES and TIMEOUT_MS; images only.

const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);

/** Addresses that aren't the public internet. */
const PRIVATE = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(address, prefix, 'ipv6');
}

/** The IPv4 address inside an IPv4-mapped IPv6 one (::ffff:a.b.c.d or ::ffff:XXXX:XXXX), else null. */
function mappedIPv4(ip: string): string | null {
  const match = /^(?:0{0,4}:){0,5}:?ffff:(.+)$/i.exec(ip.replace(/^::/, '0::'));
  if (!match) return null;
  const rest = match[1]!;
  if (net.isIPv4(rest)) return rest;
  const groups = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(rest);
  if (!groups) return null;
  const hi = parseInt(groups[1]!, 16);
  const lo = parseInt(groups[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return !PRIVATE.check(ip, 'ipv4');
  if (family === 6) {
    // An IPv4 address written as IPv6 (::ffff:127.0.0.1, or ::ffff:7f00:1 as URLs write it): checked as IPv4.
    const v4 = mappedIPv4(ip);
    if (v4) return isPublicAddress(v4);
    return !PRIVATE.check(ip, 'ipv6');
  }
  return false;
}

/** dns.lookup, keeping only public addresses (the connection then goes to one of those). */
const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const allowed = (addresses as dns.LookupAddress[]).filter((a) => isPublicAddress(a.address));
    if (allowed.length === 0) return callback(Object.assign(new Error('not a public address'), { code: 'EBLOCKED' }), '', 0);
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, allowed);
    callback(null, allowed[0]!.address, allowed[0]!.family);
  });
};

export class RemoteImageError extends Error {
  constructor(
    public code: 'image_url_invalid' | 'image_fetch_failed' | 'image_too_large' | 'file_type',
    /** What went wrong underneath (for the server's log). */
    public detail?: string,
  ) {
    super(code);
  }
}

/** Checks an address before fetching it: http(s), the usual ports, no credentials, a public host. */
function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RemoteImageError('image_url_invalid');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new RemoteImageError('image_url_invalid');
  if (url.username || url.password) throw new RemoteImageError('image_url_invalid');
  if (url.port && url.port !== '80' && url.port !== '443') throw new RemoteImageError('image_url_invalid');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // An address written as numbers is connected to as it is (no lookup to filter), so it's checked here.
  if (net.isIP(host) && !isPublicAddress(host)) throw new RemoteImageError('image_url_invalid');
  if (!net.isIP(host) && !host.includes('.')) throw new RemoteImageError('image_url_invalid'); // "localhost" and the like
  return url;
}

function get(url: URL): Promise<http.IncomingMessage> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, {
      lookup: publicLookup,
      timeout: TIMEOUT_MS,
      headers: {
        // Wikimedia and others ask for a name and a way to reach whoever asks.
        'User-Agent': `${site.name.replace(/[^\w.-]+/g, '')}/1.0 (+${config.appUrl}; image picker)`,
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8',
      },
    });
    req.on('response', resolve);
    req.on('timeout', () => req.destroy(new RemoteImageError('image_fetch_failed')));
    req.on('error', reject);
  });
}

/** The image at `raw`: its bytes and type, once it's known to really be an image. */
export async function fetchRemoteImage(raw: string): Promise<{ data: Buffer; type: string }> {
  let url = checkUrl(raw);
  let response: http.IncomingMessage | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      response = await get(url);
    } catch (err) {
      throw err instanceof RemoteImageError ? err : new RemoteImageError('image_fetch_failed', (err as Error).message);
    }
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      url = checkUrl(new URL(response.headers.location, url).href);
      response = null;
      continue;
    }
    break;
  }
  if (!response) throw new RemoteImageError('image_fetch_failed'); // too many redirects
  if (response.statusCode !== 200) {
    response.resume();
    throw new RemoteImageError('image_fetch_failed', `HTTP ${response.statusCode} from ${url.host}`);
  }
  if (Number(response.headers['content-length'] ?? 0) > MAX_BYTES) {
    response.destroy();
    throw new RemoteImageError('image_too_large');
  }

  const chunks: Buffer[] = [];
  let size = 0;
  const deadline = setTimeout(() => response.destroy(new RemoteImageError('image_fetch_failed')), TIMEOUT_MS);
  try {
    for await (const chunk of response) {
      size += (chunk as Buffer).length;
      if (size > MAX_BYTES) {
        response.destroy();
        throw new RemoteImageError('image_too_large');
      }
      chunks.push(chunk as Buffer);
    }
  } catch (err) {
    throw err instanceof RemoteImageError ? err : new RemoteImageError('image_fetch_failed');
  } finally {
    clearTimeout(deadline);
  }
  const data = Buffer.concat(chunks);

  let format: string | undefined;
  try {
    const meta = await sharp(data).metadata();
    if (meta.width && meta.height) format = meta.format;
  } catch {
    // not an image
  }
  if (!format || !FORMATS.has(format)) throw new RemoteImageError('file_type');
  return { data, type: `image/${format}` };
}
