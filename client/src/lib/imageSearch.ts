// Searching free image libraries for a banner (the editor's "Search images"), straight from the browser (both allow
// it, and each author then has their own share of their limits): Wikimedia Commons and Openverse. Only images large
// enough for a banner (BANNER_MIN), as JPEG, PNG or WebP. Each one carries who made it and its licence, kept with
// the banner as its credit.

export type ImageSource = 'wikimedia' | 'openverse' | 'web';

export interface FoundImage {
  id: string;
  source: ImageSource;
  title: string;
  /** Small, for the grid. */
  thumb: string;
  /** Larger, for looking at it. */
  preview: string;
  /** What's fetched when it's chosen (at most about the size a banner is kept at). */
  full: string;
  width: number | null;
  height: number | null;
  author: string | null;
  license: string | null;
  licenseUrl: string | null;
  /** The image's own page (its credit links there). */
  page: string | null;
}

export interface SearchPage {
  images: FoundImage[];
  /** Where the next page starts; null when there's no more. */
  next: number | null;
}

/** A banner is at least this big (BannerPicker). */
export const BANNER_MIN = { width: 1280, height: 720 };
/** Results per page (Openverse allows at most 20 without a key, and 240 in all). */
const PAGE = 20;

export class SearchLimited extends Error {}

const stripHtml = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
};

const big = (width: number | null, height: number | null) =>
  width === null || height === null || (width >= BANNER_MIN.width && height >= BANNER_MIN.height);

interface WikiInfo {
  url: string;
  descriptionurl: string;
  thumburl?: string;
  width: number;
  height: number;
  mime: string;
  extmetadata?: Record<string, { value: string } | undefined>;
}

export async function searchWikimedia(query: string, offset = 0): Promise<SearchPage> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6', // files
    gsrsearch: `${query} filetype:bitmap filew:>${BANNER_MIN.width - 1} fileh:>${BANNER_MIN.height - 1}`,
    gsrlimit: String(PAGE),
    gsroffset: String(offset),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ObjectName',
    iiurlwidth: '500',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
  if (!res.ok) throw new Error(`wikimedia ${res.status}`);
  const data = (await res.json()) as {
    continue?: { gsroffset?: number };
    query?: { pages?: Record<string, { pageid: number; title: string; index: number; imageinfo?: WikiInfo[] }> };
  };
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  const images: FoundImage[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl || !/^image\/(jpeg|png|webp)$/.test(info.mime) || !big(info.width, info.height)) continue;
    const meta = info.extmetadata ?? {};
    // Larger copies of the same picture are made by Wikimedia at standard widths (1280, 1920, 3840...). The one
    // fetched is the smallest still tall enough for a banner (a panorama needs a wide one), or the original.
    const sized = (width: number) => info.thumburl!.replace(/\/\d+px-/, `/${width}px-`);
    const tallEnough = (width: number) => (width * info.height) / info.width >= BANNER_MIN.height;
    const fetchWidth = [1920, 3840].find((width) => width < info.width && tallEnough(width));
    images.push({
      id: `wikimedia:${page.pageid}`,
      source: 'wikimedia',
      title: meta.ObjectName?.value ? stripHtml(meta.ObjectName.value) : page.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
      thumb: info.thumburl,
      preview: sized(1280),
      full: fetchWidth ? sized(fetchWidth) : info.url,
      width: info.width,
      height: info.height,
      author: meta.Artist?.value ? stripHtml(meta.Artist.value) || null : null,
      license: meta.LicenseShortName?.value ? stripHtml(meta.LicenseShortName.value) : null,
      licenseUrl: meta.LicenseUrl?.value ?? null,
      page: info.descriptionurl,
    });
  }
  return { images, next: data.continue?.gsroffset ?? null };
}

interface OpenverseResult {
  id: string;
  title: string | null;
  url: string;
  thumbnail: string;
  creator: string | null;
  license: string;
  license_version: string | null;
  license_url: string | null;
  foreign_landing_url: string | null;
  width: number | null;
  height: number | null;
  filetype: string | null;
}

const licenseName = (license: string, version: string | null) =>
  license === 'cc0' ? 'CC0' : license === 'pdm' ? 'Public Domain' : `CC ${license.toUpperCase()}${version ? ` ${version}` : ''}`;

export async function searchOpenverse(query: string, page = 1): Promise<SearchPage> {
  const params = new URLSearchParams({ q: query, page: String(page), page_size: String(PAGE), size: 'large', extension: 'jpg,png,webp' });
  const res = await fetch(`https://api.openverse.org/v1/images/?${params}`);
  if (res.status === 429) throw new SearchLimited();
  if (!res.ok) throw new Error(`openverse ${res.status}`);
  const data = (await res.json()) as { page_count: number; results: OpenverseResult[] };
  const images = data.results
    .filter((r) => big(r.width, r.height))
    .map((r) => ({
      id: `openverse:${r.id}`,
      source: 'openverse' as const,
      title: r.title || '',
      thumb: r.thumbnail,
      preview: r.url,
      full: r.url,
      width: r.width,
      height: r.height,
      author: r.creator,
      license: licenseName(r.license, r.license_version),
      licenseUrl: r.license_url,
      page: r.foreign_landing_url,
    }));
  return { images, next: page < data.page_count ? page + 1 : null };
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * An image at an address the author pasted or dragged in (from Google or elsewhere): nothing else is known about it.
 * A Google (or Bing) result's link is turned into the image's own address, and the page it's on.
 */
export function webImage(raw: string): FoundImage {
  let url = raw.trim();
  let page: string | null = url.startsWith('data:') ? null : url;
  try {
    const link = new URL(url);
    const image = link.searchParams.get('imgurl') ?? link.searchParams.get('mediaurl');
    if (/(^|\.)(google|bing)\.[a-z.]+$/.test(link.hostname) && image) {
      url = image;
      page = link.searchParams.get('imgrefurl') ?? image;
    }
  } catch {
    // not a link (a data: address, or something to be refused)
  }
  return {
    id: `web:${url}`,
    source: 'web',
    title: page ? hostOf(page) : '',
    thumb: url,
    preview: url,
    full: url,
    width: null,
    height: null,
    author: null,
    license: null,
    licenseUrl: null,
    page,
  };
}

/** Google Images for a search, in a new tab: large images, and with `free`, only those under Creative Commons. */
export function googleImagesUrl(query: string, free: boolean) {
  const params = new URLSearchParams({ q: query, udm: '2', tbs: free ? 'isz:l,il:cl' : 'isz:l' });
  return `https://www.google.com/search?${params}`;
}

/** Whatever was typed looks like an image's address, not words to search for. */
export const looksLikeUrl = (text: string) => /^(https?:\/\/\S+|data:image\/)/i.test(text.trim());

/** The credit kept with a banner: who made it, its licence, where from; and the page it links to. */
export function creditOf(image: FoundImage): { text: string; url: string | null } {
  if (image.source === 'web') return { text: image.title, url: image.page && /^https?:/.test(image.page) ? image.page.slice(0, 500) : null };
  const where = image.source === 'wikimedia' ? 'Wikimedia Commons' : 'Openverse';
  const parts = [image.author, image.license, `via ${where}`].filter(Boolean);
  return { text: parts.join(', ').slice(0, 300), url: image.page };
}

/** The address an image was dragged from (another tab's picture: a link, or HTML with an <img>). */
export function droppedImageUrl(data: DataTransfer): string | null {
  const html = data.getData('text/html');
  if (html) {
    const src = new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.getAttribute('src');
    if (src) return src;
  }
  const uri = data.getData('text/uri-list').split('\n').find((line) => line && !line.startsWith('#'));
  if (uri) return uri.trim();
  const text = data.getData('text/plain').trim();
  return /^(https?:|data:image\/)/.test(text) ? text : null;
}
