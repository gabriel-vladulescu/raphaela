import type { Pool, RowDataPacket } from 'mysql2/promise';
import { site } from '../../../site.config';
import { config } from '@/config';
import { loadPostPage } from '@/lib/posts';
import { escapeHtml, scriptJson } from '@/seo/html';
import type { PageMeta } from '@/seo/html';
import { BRAND_VERSION } from '@/seo/brand';
import { OG_HEIGHT, OG_WIDTH, profileSharePath, siteShareImage } from '@/seo/og';
import type { ProfileList } from '@/seo/og';
import { findPerson } from '@/lib/people';

// What each page's HTML says before the app runs: the title, description and canonical address search engines use,
// the share tags (Open Graph, X) link previews use, structured data (schema.org), and for posts the content itself,
// so it's indexed right away and shows before the app has loaded. Everyone gets the same page; nothing depends on
// who's asking.

const INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const NO_INDEX = 'noindex, follow';
/** Pages for signed-in people (or tools): never in search results. */
const PRIVATE_PAGES = /^\/(login|register|saved|articole-salvate|profil|setari|notificari|statistici|suport)\/?$|^\/(admin|editor)\/|^\/[^/]+\/articole\/[^/]+\/?$/;

export const siteOrigin = () => config.appUrl.replace(/\/+$/, '');
const absolute = (url: string) => (/^https?:\/\//.test(url) ? url : `${siteOrigin()}${url}`);

/** Search results show about 160 characters of the description. */
function shorten(text: string, max = 160) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, clean.lastIndexOf(' ', max - 1) || max - 1)}…`;
}

interface Head {
  /** The page's own title, without the site name (for link previews). */
  title: string;
  description: string;
  canonical?: string;
  robots: string;
  type?: 'website' | 'article';
  image?: { url: string; alt: string };
  extra?: string[];
  jsonLd?: unknown[];
}

function headTags(head: Head) {
  const meta = (attr: 'name' | 'property', key: string, value: string | null | undefined) =>
    value ? `<meta ${attr}="${key}" content="${escapeHtml(value)}">` : '';
  const image = head.image;
  return [
    meta('name', 'description', shorten(head.description)),
    meta('name', 'robots', head.robots),
    head.canonical ? `<link rel="canonical" href="${escapeHtml(head.canonical)}">` : '',
    meta('property', 'og:site_name', site.name),
    meta('property', 'og:locale', site.locale),
    meta('property', 'og:type', head.type ?? 'website'),
    meta('property', 'og:title', head.title),
    meta('property', 'og:description', head.description),
    meta('property', 'og:url', head.canonical),
    ...(image
      ? [
          meta('property', 'og:image', image.url),
          meta('property', 'og:image:type', 'image/jpeg'),
          meta('property', 'og:image:width', String(OG_WIDTH)),
          meta('property', 'og:image:height', String(OG_HEIGHT)),
          meta('property', 'og:image:alt', image.alt),
        ]
      : []),
    meta('name', 'twitter:card', image ? 'summary_large_image' : 'summary'),
    meta('name', 'twitter:title', head.title),
    meta('name', 'twitter:description', shorten(head.description, 200)),
    meta('name', 'twitter:image', image?.url),
    meta('name', 'twitter:image:alt', image?.alt),
    ...(head.extra ?? []),
    `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.name)}" href="${siteOrigin()}/rss.xml">`,
    ...(head.jsonLd ?? []).map((data) => `<script type="application/ld+json">${scriptJson(data)}</script>`),
  ]
    .filter(Boolean)
    .join('\n    ');
}

const page = (status: number, title: string, head: Head, root = '', data: PageMeta['data'] = null): PageMeta => ({
  status,
  title,
  head: headTags(head),
  root,
  data,
});

const publisher = () => ({
  '@type': 'Organization',
  name: site.name,
  url: `${siteOrigin()}/`,
  logo: { '@type': 'ImageObject', url: `${siteOrigin()}/api/og/logo.png?v=${BRAND_VERSION}`, width: 512, height: 512 },
});

function siteImage() {
  return { url: `${siteOrigin()}/api/og/site.jpg?v=${siteShareImage().version}`, alt: site.name };
}

interface CategoryRow {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
}

async function categories(db: Pool) {
  const [rows] = await db.query<RowDataPacket[]>('SELECT id, parent_id, name, slug, icon, description FROM categories');
  return new Map(rows.map((row) => [row.id as number, row as unknown as CategoryRow]));
}

/** A category and the ones above it, top first (the post page's chips and the breadcrumb). */
function trailOf(all: Map<number, CategoryRow>, id: number | null | undefined) {
  const trail: CategoryRow[] = [];
  for (let current = id ?? null; current !== null && trail.length < 10; ) {
    const category = all.get(current);
    if (!category) break;
    trail.unshift(category);
    current = category.parent_id;
  }
  return trail;
}

const breadcrumb = (items: { name: string; url: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: item.url })),
});

async function home(db: Pool, params: URLSearchParams): Promise<PageMeta> {
  const origin = siteOrigin();
  // Search results: useful to visitors, not as pages in search engines.
  if (params.get('q')) return page(200, site.name, { title: site.name, description: site.description, robots: NO_INDEX, image: siteImage() });

  const slug = params.get('category');
  if (slug) {
    const all = await categories(db);
    const category = [...all.values()].find((c) => c.slug === slug);
    if (!category) return notFound();
    const canonical = `${origin}/?category=${encodeURIComponent(category.slug)}`;
    const trail = trailOf(all, category.id);
    return page(200, `${category.name} · ${site.name}`, {
      title: category.name,
      description: category.description || `${category.name}: articole din ${site.name}. ${site.description}`,
      canonical,
      robots: INDEX,
      image: siteImage(),
      jsonLd: [
        breadcrumb([
          { name: site.name, url: `${origin}/` },
          ...trail.map((c) => ({ name: c.name, url: `${origin}/?category=${encodeURIComponent(c.slug)}` })),
        ]),
      ],
    });
  }

  return page(200, site.name, {
    title: site.name,
    description: site.description,
    canonical: `${origin}/`,
    robots: INDEX,
    image: siteImage(),
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: site.name,
        url: `${origin}/`,
        inLanguage: site.language,
        description: site.description,
        potentialAction: { '@type': 'SearchAction', target: `${origin}/?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
      },
      { '@context': 'https://schema.org', ...publisher() },
    ],
  });
}

// The post as the app shows it, so nothing moves when the app takes over (same classes; lucide's icons).
const icon = (shapes: string, size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`;
const ARROW_LEFT = '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>';
const CALENDAR =
  '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M8 17h.01"/><path d="M12 17h.01"/><path d="M16 17h.01"/>';
const CLOCK = '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>';
const EYE = '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>';

/** A series' parts above the text, as the post page shows them (Romanian, like the rest of the pre-render). */
function seriesBox(post: LoadedPost) {
  const parts = post.series?.parts ?? [];
  if (!post.series || parts.length < 2) return '';
  const index = parts.findIndex((part) => part.id === post.id);
  const items = parts
    .map((part) =>
      part.id === post.id
        ? `<li class="is-current"><span aria-current="page">${escapeHtml(part.title)}</span></li>`
        : `<li><a href="/posts/${encodeURIComponent(part.slug)}">${escapeHtml(part.title)}</a></li>`,
    )
    .join('');
  const place = index >= 0 ? `<span class="series-box-part">Partea ${index + 1} din ${parts.length}</span>` : '';
  return `<nav class="series-box" aria-label="Seria"><p class="series-box-head"><span class="series-box-label">Seria</span><strong>${escapeHtml(post.series.title)}</strong>${place}</p><ol class="series-box-parts">${items}</ol></nav>`;
}

/** "1 vizualizare", "3 vizualizări", "20 de vizualizări" (as the client's plural()). */
function romanianViews(n: number) {
  const count = new Intl.NumberFormat('ro-RO').format(n);
  if (n === 1) return '1 vizualizare';
  return n % 100 >= 1 && n % 100 <= 19 ? `${count} vizualizări` : `${count} de vizualizări`;
}

function footer() {
  return `<footer class="site-footer"><div class="container footer-inner"><span>© ${escapeHtml(site.company)} ${new Date().getFullYear()}</span><span aria-hidden="true">·</span><a href="/termeni-si-conditii" class="footer-link">Termeni și Condiții</a></div></footer>`;
}

type LoadedPost = NonNullable<Awaited<ReturnType<typeof loadPostPage>>>['post'];

function postRoot(post: LoadedPost, trail: CategoryRow[]) {
  const date = post.publishedAt
    ? new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: site.timeZone }).format(post.publishedAt)
    : '';
  const chips = trail
    .map(
      (c) =>
        `<a href="/?category=${encodeURIComponent(c.slug)}" class="chip chip-link">${c.icon ? `<span aria-hidden="true">${escapeHtml(c.icon)}</span>` : ''}${escapeHtml(c.name)}</a>`,
    )
    .join('');
  const banner = post.bannerUrl
    ? `<img class="post-hero-img" src="${escapeHtml(post.bannerUrl)}" alt="" fetchpriority="high">`
    : `<span class="post-hero-glyph" aria-hidden="true">${escapeHtml(post.category?.icon || '✦')}</span>`;
  return `<header class="site-header"><div class="container header-inner"></div></header>
<main class="site-main">
  <article class="post-page container">
    <div class="post-topbar"><a href="/" class="back-link">${icon(ARROW_LEFT, 16)} Înapoi la articole</a></div>
    <header class="post-hero${post.bannerUrl ? '' : ' is-plain'}">
      ${banner}
      <div class="post-hero-text">
        ${chips ? `<nav class="post-categories" aria-label="breadcrumb">${chips}</nav>` : ''}
        <h1 class="post-title">${escapeHtml(post.title)}</h1>
      </div>
    </header>
    <div class="post-meta">${date ? `<span>${icon(CALENDAR, 15)} Publicat pe ${date}</span>` : ''}<span>${icon(CLOCK, 15)} ${post.readingMinutes} min de citit</span>${post.viewCount > 0 ? `<span>${icon(EYE, 15)} ${romanianViews(post.viewCount)}</span>` : ''}</div>
    <div class="post-layout">
      <div class="post-main">${seriesBox(post)}<div class="prose post-content">${post.contentHtml}</div></div>
      <aside class="post-side"></aside>
    </div>
  </article>
</main>
${footer()}`;
}

async function postPage(db: Pool, slug: string): Promise<PageMeta> {
  // The public version: drafts, scheduled and deleted posts are "not found" here (their author still sees them in
  // the app, which asks the API with their session).
  const loaded = await loadPostPage(db, slug, null);
  if (!loaded) return notFound();
  const { post, text } = loaded;
  const origin = siteOrigin();
  const canonical = `${origin}/posts/${encodeURIComponent(post.slug)}`;
  const trail = trailOf(await categories(db), post.category?.id);
  const image = { url: absolute(post.shareImage), alt: post.title };
  const published = post.publishedAt?.toISOString();
  const modified = new Date(post.updatedAt).toISOString();

  return page(
    200,
    `${post.title} · ${site.name}`,
    {
      title: post.title,
      description: post.excerpt,
      canonical,
      robots: INDEX,
      type: 'article',
      image,
      extra: [
        `<meta name="author" content="${escapeHtml(post.author.name)}">`,
        published ? `<meta property="article:published_time" content="${published}">` : '',
        `<meta property="article:modified_time" content="${modified}">`,
        `<meta property="article:author" content="${escapeHtml(post.author.name)}">`,
        trail.length ? `<meta property="article:section" content="${escapeHtml(trail.at(-1)!.name)}">` : '',
        ...trail.map((c) => `<meta property="article:tag" content="${escapeHtml(c.name)}">`),
        // Slack, Discord and others show these under the preview.
        `<meta name="twitter:label1" content="Timp de citit"><meta name="twitter:data1" content="${post.readingMinutes} min">`,
        `<meta name="twitter:label2" content="Scris de"><meta name="twitter:data2" content="${escapeHtml(post.author.name)}">`,
        // The banner is the largest thing on the page: start loading it with the HTML.
        post.bannerUrl ? `<link rel="preload" as="image" href="${escapeHtml(post.bannerUrl)}" fetchpriority="high">` : '',
      ].filter(Boolean),
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          '@id': `${canonical}#article`,
          mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
          url: canonical,
          headline: post.title.slice(0, 110),
          description: post.excerpt,
          image: [image.url, ...(post.bannerUrl ? [absolute(post.bannerUrl)] : [])],
          datePublished: published,
          dateModified: modified,
          author: { '@type': 'Person', name: post.author.name, ...(post.author.occupation ? { jobTitle: post.author.occupation } : {}) },
          publisher: publisher(),
          articleSection: trail.at(-1)?.name,
          keywords: trail.map((c) => c.name).join(', ') || undefined,
          inLanguage: site.language,
          wordCount: text.split(/\s+/).filter(Boolean).length,
          timeRequired: `PT${post.readingMinutes}M`,
          isAccessibleForFree: true,
          ...(post.series ? { isPartOf: { '@type': 'CreativeWorkSeries', name: post.series.title }, position: post.series.part } : {}),
        },
        breadcrumb([
          { name: site.name, url: `${origin}/` },
          ...trail.map((c) => ({ name: c.name, url: `${origin}/?category=${encodeURIComponent(c.slug)}` })),
          { name: post.title, url: canonical },
        ]),
      ],
    },
    postRoot(post, trail),
    { post },
  );
}

function notFound(): PageMeta {
  return page(404, `Pagina nu există · ${site.name}`, { title: site.name, description: site.description, robots: 'noindex' });
}

/** The title, tags and initial content for the page at `url` (a path, with its query). */
/** A person's list: their name and the list, with their share image; for search engines only when it's public. */
async function personPage(db: Pool, username: string, list: ProfileList): Promise<PageMeta> {
  const person = await findPerson(db, username);
  if (!person) return notFound();
  const isPublic = list === 'articole' ? person.publicArticles : person.publicSaved;
  const title = `${list === 'articole' ? 'Articole de' : 'Articole salvate de'} ${person.name} · ${site.name}`;
  if (!isPublic) return page(200, title, { title, description: site.description, robots: NO_INDEX });
  const description =
    list === 'articole'
      ? `Articolele scrise de ${person.name}${person.occupation ? `, ${person.occupation}` : ''}, pe ${site.name}.`
      : `Articolele salvate de ${person.name} pe ${site.name}.`;
  return page(200, title, {
    title,
    description,
    canonical: `${siteOrigin()}/${person.username}/${list}`,
    robots: list === 'articole' ? INDEX : NO_INDEX,
    image: { url: `${siteOrigin()}${profileSharePath(person, list)}`, alt: title },
  });
}

export async function describePage(db: Pool, url: string): Promise<PageMeta> {
  const { pathname, searchParams } = new URL(url, 'http://localhost');
  if (pathname === '/' || pathname === '/index.html') return home(db, searchParams);
  const post = /^\/posts\/([^/]+)\/?$/.exec(pathname);
  if (post) return postPage(db, decodeURIComponent(post[1]!));
  if (pathname === '/termeni-si-conditii') {
    return page(200, `Termeni și Condiții · ${site.name}`, {
      title: `Termeni și Condiții · ${site.name}`,
      description: `Termenii și condițiile de utilizare ${site.name}.`,
      canonical: `${siteOrigin()}/termeni-si-conditii`,
      robots: INDEX,
      image: siteImage(),
    });
  }
  if (PRIVATE_PAGES.test(pathname)) return page(200, site.name, { title: site.name, description: site.description, robots: 'noindex' });
  const list = /^\/([a-z0-9.]{3,30})\/(articole|articole-salvate)\/?$/.exec(pathname);
  if (list) return personPage(db, list[1]!, list[2] as ProfileList);
  return notFound();
}
