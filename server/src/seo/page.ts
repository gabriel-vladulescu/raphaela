import type { Pool, RowDataPacket } from 'mysql2/promise';
import { freshAuthorCount } from '@/lib/follows';
import { config } from '@/config';
import { bookSelect, chaptersOf, toBook } from '@/lib/books';
import { loadPostPage, postPath, VISIBLE_POST } from '@/lib/posts';
import { publicIdentity, site } from '@/lib/siteIdentity';
import { publicSiteSettings, siteSettings } from '@/lib/siteSettings';
import { escapeHtml, scriptJson } from '@/seo/html';
import type { PageMeta } from '@/seo/html';
import { BRAND_VERSION } from '@/seo/brand';
import { OG_HEIGHT, OG_WIDTH, profileSharePath, siteShareImage } from '@/seo/og';
import { findPerson, hasList, isPublicList, PERSON_LISTS } from '@/lib/people';
import type { PersonList } from '@/lib/people';

// What each page's HTML says before the app runs: the title, description and canonical address search engines use,
// the share tags (Open Graph, X) link previews use, structured data (schema.org), and for posts the content itself,
// so it's indexed right away and shows before the app has loaded. Everyone gets the same page; nothing depends on
// who's asking.

const INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const NO_INDEX = 'noindex, follow';
/** Pages for signed-in people (or tools): never in search results. */
const PRIVATE_PAGES =
  /^\/(login|register|salvate|profil|setari|notificari|statistici|suport|parola-uitata|resetare-parola|confirmare-email|invitatie|setup|drumuri)\/?$|^\/(admin|editor|previzualizare|newsletter|jurnalul-meu|cartile-mele|suport\/tichete)(\/|$)|^\/[^/]+\/articole\/[^/]+\/?$|^\/[^/]+\/(jurnal|carti)\/.+/;

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

/** The journal (/jurnal): the articles, a category's (?category=) or a search's (?q=). */
async function journal(db: Pool, params: URLSearchParams): Promise<PageMeta> {
  const origin = siteOrigin();
  const title = `Jurnal · ${site.name}`;
  // Search results: useful to visitors, not as pages in search engines.
  if (params.get('q')) return page(200, title, { title, description: site.description, robots: NO_INDEX, image: siteImage() });

  const slug = params.get('category');
  if (!slug) {
    return page(200, title, { title, description: `Articolele din ${site.name}. ${site.description}`, canonical: `${origin}/jurnal`, robots: INDEX, image: siteImage() });
  }
  {
    const all = await categories(db);
    const category = [...all.values()].find((c) => c.slug === slug);
    if (!category) return notFound();
    const canonical = `${origin}/jurnal?category=${encodeURIComponent(category.slug)}`;
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
          ...trail.map((c) => ({ name: c.name, url: `${origin}/jurnal?category=${encodeURIComponent(c.slug)}` })),
        ]),
      ],
    });
  }
}

/** The home page ("Today"): the books, the subjects and the latest articles. */
function home(params: URLSearchParams): PageMeta {
  const origin = siteOrigin();
  // Earlier addresses of the articles' list (/?category=, /?q=): it's the journal now.
  if (params.get('q') || params.get('category')) return { ...notFound(), status: 301, redirect: `/jurnal?${params}` };
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
        potentialAction: { '@type': 'SearchAction', target: `${origin}/jurnal?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
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

/** A count and its noun in Romanian's three plural forms (one, a few, twenty and more), as the client's plural(). */
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
        `<a href="/jurnal?category=${encodeURIComponent(c.slug)}" class="chip chip-link">${c.icon ? `<span aria-hidden="true">${escapeHtml(c.icon)}</span>` : ''}${escapeHtml(c.name)}</a>`,
    )
    .join('');
  const banner = post.bannerUrl
    ? `<img class="post-hero-img" src="${escapeHtml(post.bannerUrl)}" alt="" fetchpriority="high">`
    : `<span class="post-hero-glyph" aria-hidden="true">${escapeHtml(post.category?.icon || '✦')}</span>`;
  // A chapter leads back to its book; a post to the journal.
  const back = post.book ? `<a href="/carti/${encodeURIComponent(post.book.slug)}" class="back-link">${icon(ARROW_LEFT, 16)} ${escapeHtml(post.book.title)}</a>` : `<a href="/jurnal" class="back-link">${icon(ARROW_LEFT, 16)} Înapoi la articole</a>`;
  return `<header class="site-header"><div class="container header-inner"></div></header>
<main class="site-main">
  <article class="post-page container${post.book ? ' is-chapter' : ''}">
    <div class="post-topbar">${back}</div>
    <header class="post-hero${post.bannerUrl ? '' : ' is-plain'}">
      ${banner}
      <div class="post-hero-text">
        ${chips ? `<nav class="post-categories" aria-label="breadcrumb">${chips}</nav>` : ''}
        <h1 class="post-title">${escapeHtml(post.title)}</h1>
      </div>
    </header>
    <div class="post-meta">${date ? `<span>${icon(CALENDAR, 15)} Publicat pe ${date}</span>` : ''}<span>${icon(CLOCK, 15)} ${post.readingMinutes} min de citit</span>${post.viewCount > 0 ? `<span>${icon(EYE, 15)} ${romanianViews(post.viewCount)}</span>` : ''}</div>
    <div class="post-layout">
      <div class="post-main"><div class="prose post-content">${post.contentHtml}</div></div>
      <aside class="post-side"></aside>
    </div>
  </article>
</main>
${footer()}`;
}

/** A post (/posts/{slug}), or a chapter of a book (/carti/{book}/{slug}: `book` is its slug). */
async function postPage(db: Pool, slug: string, book: string | null = null): Promise<PageMeta> {
  // The public version: drafts, scheduled and deleted posts are "not found" here (their author still sees them in
  // the app, which asks the API with their session).
  const loaded = await loadPostPage(db, slug, null, book);
  if (!loaded) return notFound();
  const { post, text, seo } = loaded;
  const origin = siteOrigin();
  const canonical = `${origin}${post.path}`;
  const bookUrl = post.book ? `${origin}/carti/${encodeURIComponent(post.book.slug)}` : null;
  const trail = trailOf(await categories(db), post.category?.id);
  // The author's own search title, description and share image, when they set them.
  const image = { url: absolute(seo.image ?? post.shareImage), alt: post.title };
  const searchTitle = seo.title ?? post.title;
  const published = post.publishedAt?.toISOString();
  const modified = new Date(post.updatedAt).toISOString();

  return page(
    200,
    `${searchTitle} · ${site.name}`,
    {
      title: searchTitle,
      description: seo.description ?? post.excerpt,
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
        ...[...trail.map((c) => c.name), ...post.tags.map((t) => t.name)].map((name) => `<meta property="article:tag" content="${escapeHtml(name)}">`),
        // Slack, Discord and others show these under the preview.
        `<meta name="twitter:label1" content="Timp de citit"><meta name="twitter:data1" content="${post.readingMinutes} min">`,
        `<meta name="twitter:label2" content="Scris de"><meta name="twitter:data2" content="${escapeHtml(post.author.name)}">`,
        // The banner is the largest thing on the page: start loading it with the HTML.
        post.bannerUrl ? `<link rel="preload" as="image" href="${escapeHtml(post.bannerUrl)}" fetchpriority="high">` : '',
      ].filter(Boolean),
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': post.book ? 'Chapter' : 'BlogPosting',
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
          keywords: [...trail.map((c) => c.name), ...post.tags.map((t) => t.name)].join(', ') || undefined,
          inLanguage: site.language,
          wordCount: text.split(/\s+/).filter(Boolean).length,
          timeRequired: `PT${post.readingMinutes}M`,
          isAccessibleForFree: true,
          ...(post.book && bookUrl ? { isPartOf: { '@type': 'Book', name: post.book.title, url: bookUrl }, position: post.book.contents.find((c) => c.id === post.id)?.no } : {}),
        },
        breadcrumb(
          post.book && bookUrl
            ? [
                { name: site.name, url: `${origin}/` },
                { name: 'Cărți', url: `${origin}/carti` },
                { name: post.book.title, url: bookUrl },
                { name: post.title, url: canonical },
              ]
            : [
                { name: site.name, url: `${origin}/` },
                ...trail.map((c) => ({ name: c.name, url: `${origin}/?category=${encodeURIComponent(c.slug)}` })),
                { name: post.title, url: canonical },
              ],
        ),
      ],
    },
    postRoot(post, trail),
    { post },
  );
}

/** Where an address leads now, if it isn't a post's own (a chapter's slug: under its book; an old address: the new
 *  one). Null: nowhere. */
async function redirectFor(db: Pool, slug: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.slug, bk.slug AS book_slug FROM posts p LEFT JOIN books bk ON bk.id = p.book_id
      WHERE (p.slug = ? OR p.id = (SELECT r.post_id FROM post_redirects r WHERE r.old_slug = ?)) AND ${VISIBLE_POST}
      ORDER BY p.slug = ? DESC LIMIT 1`,
    [slug, slug, slug],
  );
  return rows[0] ? postPath(rows[0].slug as string, (rows[0].book_slug as string | null) ?? null) : null;
}

/** A tag's page (/eticheta/{slug}): its posts, for search engines once it has some. */
async function tagPage(db: Pool, slug: string): Promise<PageMeta> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.name, t.slug, (SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id = pt.post_id WHERE pt.tag_id = t.id AND ${VISIBLE_POST}) AS posts
       FROM tags t WHERE t.slug = ?`,
    [slug],
  );
  const tag = rows[0];
  if (!tag) return notFound();
  const title = `${tag.name as string} · ${site.name}`;
  return page(200, title, {
    title,
    description: `Articole despre ${tag.name as string} pe ${site.name}.`,
    canonical: `${siteOrigin()}/eticheta/${tag.slug as string}`,
    robots: Number(tag.posts) > 0 ? INDEX : NO_INDEX,
    image: siteImage(),
  });
}

/** The library (/carti). */
function library(): PageMeta {
  const title = `Cărți · ${site.name}`;
  return page(200, title, {
    title,
    description: `Cărțile din ${site.name}, citite capitol cu capitol.`,
    canonical: `${siteOrigin()}/carti`,
    robots: INDEX,
    image: siteImage(),
  });
}

/** A book (/carti/{slug}): its description, author and chapters, for search engines once a chapter is public. */
async function bookPage(db: Pool, slug: string): Promise<PageMeta> {
  const [rows] = await db.query<RowDataPacket[]>(`${bookSelect()} WHERE bk.slug = ? AND bk.deleted_at IS NULL`, [slug]);
  if (!rows[0]) return notFound();
  const book = toBook(rows[0]);
  if (book.chapters === 0 || !book.published) return page(200, site.name, { title: site.name, description: site.description, robots: 'noindex' });
  const origin = siteOrigin();
  const canonical = `${origin}/carti/${encodeURIComponent(book.slug)}`;
  const contents = (await chaptersOf(db, [book.id], null)).get(book.id) ?? [];
  const title = `${book.title} · ${site.name}`;
  const about = book.subject ? ` despre ${book.subject.name.toLowerCase()}` : '';
  const description = book.description || `${book.title}, o carte de ${book.author.name}${about}, capitol cu capitol, pe ${site.name}.`;
  return page(200, title, {
    title: book.title,
    description,
    canonical,
    robots: INDEX,
    image: siteImage(),
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Book',
        name: book.title,
        description,
        url: canonical,
        inLanguage: site.language,
        author: { '@type': 'Person', name: book.author.name },
        publisher: publisher(),
        ...(book.subject ? { genre: book.subject.name } : {}),
        hasPart: contents
          .filter((chapter) => chapter.slug)
          .map((chapter) => ({ '@type': 'Chapter', name: chapter.title, position: chapter.no, url: `${origin}${postPath(chapter.slug!, book.slug)}` })),
      },
      breadcrumb([
        { name: site.name, url: `${origin}/` },
        { name: 'Cărți', url: `${origin}/carti` },
        { name: book.title, url: canonical },
      ]),
    ],
  });
}

function subjectsPage(): PageMeta {
  const title = `Subiecte · ${site.name}`;
  return page(200, title, { title, description: `Subiectele din ${site.name}: cărți și articole.`, canonical: `${siteOrigin()}/subiecte`, robots: INDEX, image: siteImage() });
}

async function subjectPage(db: Pool, slug: string): Promise<PageMeta> {
  const all = await categories(db);
  const category = [...all.values()].find((c) => c.slug === slug);
  if (!category) return notFound();
  const title = `${category.name} · ${site.name}`;
  return page(200, title, {
    title: category.name,
    description: category.description || `${category.name}: cărți și articole din ${site.name}.`,
    canonical: `${siteOrigin()}/subiecte/${encodeURIComponent(category.slug)}`,
    robots: INDEX,
    image: siteImage(),
  });
}

function notFound(): PageMeta {
  return page(404, `Pagina nu există · ${site.name}`, { title: site.name, description: site.description, robots: 'noindex' });
}

/** The title, tags and initial content for the page at `url` (a path, with its query). */
const LIST_TITLES: Record<PersonList, string> = { jurnal: 'Jurnal', carti: 'Cărți', salvate: 'Articole salvate' };

/**
 * A person's list (/{username}/jurnal, /carti, /salvate): their name and the list, with its share image. Private (or
 * not theirs to have): not for search engines. Public: their journal and books are, their saved posts aren't.
 */
async function personPage(db: Pool, username: string, list: PersonList): Promise<PageMeta> {
  const person = await findPerson(db, username);
  if (!person) return notFound();
  const title = `${LIST_TITLES[list]} · ${person.name} · ${site.name}`;
  if (!isPublicList(person, list)) return page(200, title, { title, description: site.description, robots: NO_INDEX });
  const who = `${person.name}${person.occupation ? `, ${person.occupation}` : ''}`;
  const description =
    list === 'jurnal'
      ? `Articolele scrise de ${who}, pe ${site.name}.`
      : list === 'carti'
        ? `Cărțile scrise de ${who}, pe ${site.name}.`
        : `Articolele salvate de ${person.name} pe ${site.name}.`;
  return page(200, title, {
    title,
    description,
    canonical: `${siteOrigin()}/${person.username}/${list}`,
    robots: list === 'salvate' ? NO_INDEX : INDEX,
    image: { url: `${siteOrigin()}${profileSharePath(person, list)}`, alt: title },
  });
}

/**
 * The title, tags and initial content for the page at `url` (a path, with its query), with what every page needs
 * (window.__SITE__). `viewer`: an administrator still sees the site while it's in maintenance; everyone else gets a
 * "back soon" page (503, nothing of the content).
 */
export async function describePage(db: Pool, url: string, viewer: { id: number; role: string } | null = null): Promise<PageMeta> {
  await freshAuthorCount(db);
  const info = { identity: publicIdentity(), settings: publicSiteSettings(), brand: BRAND_VERSION };
  if (siteSettings().maintenance && viewer?.role !== 'owner') {
    return { ...page(503, site.name, { title: site.name, description: site.description, robots: 'noindex' }), site: info };
  }
  return { ...(await describeRoute(db, url, viewer)), site: info };
}

async function describeRoute(db: Pool, url: string, viewer: { id: number; role: string } | null): Promise<PageMeta> {
  const { pathname, searchParams } = new URL(url, 'http://localhost');
  if (pathname === '/' || pathname === '/index.html') return home(searchParams);
  if (pathname === '/jurnal' || pathname === '/jurnal/') return journal(db, searchParams);
  if (pathname === '/carti' || pathname === '/carti/') return library();
  const book = /^\/carti\/([^/]+)\/?$/.exec(pathname);
  if (book) return bookPage(db, decodeURIComponent(book[1]!));
  // A chapter, under its book (moved, or renamed: there for good).
  const chapter = /^\/carti\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (chapter) {
    const slug = decodeURIComponent(chapter[2]!);
    const found = await postPage(db, slug, decodeURIComponent(chapter[1]!));
    if (found.status !== 404) return found;
    const moved = await redirectFor(db, slug);
    return moved ? { ...found, status: 301, redirect: moved } : found;
  }
  if (pathname === '/subiecte' || pathname === '/subiecte/') return subjectsPage();
  const subject = /^\/subiecte\/([^/]+)\/?$/.exec(pathname);
  if (subject) return subjectPage(db, decodeURIComponent(subject[1]!));
  const post = /^\/posts\/([^/]+)\/?$/.exec(pathname);
  if (post) {
    const slug = decodeURIComponent(post[1]!);
    const found = await postPage(db, slug);
    if (found.status !== 404) return found;
    // A chapter (it's read under its book), or an old address of a post (its slug changed): there for good.
    const moved = await redirectFor(db, slug);
    return moved ? { ...found, status: 301, redirect: moved } : found;
  }
  const tag = /^\/eticheta\/([^/]+)\/?$/.exec(pathname);
  if (tag) return tagPage(db, decodeURIComponent(tag[1]!));
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
  // The old addresses: a person's articles (now their journal), their saved posts, one's own saved posts.
  const oldList = /^\/([a-z0-9.]{3,30})\/(articole|articole-salvate)\/?$/.exec(pathname);
  if (oldList) return { ...notFound(), status: 301, redirect: `/${oldList[1]}/${oldList[2] === 'articole' ? 'jurnal' : 'salvate'}` };
  if (/^\/(articole-salvate|saved)\/?$/.test(pathname)) return { ...notFound(), status: 301, redirect: '/salvate' };
  const list = /^\/([a-z0-9.]{3,30})\/(jurnal|carti|salvate)\/?$/.exec(pathname);
  if (list) return personPage(db, list[1]!, list[2] as PersonList);
  const person = /^\/([a-z0-9.]{3,30})\/?$/.exec(pathname);
  if (person) return personIndex(db, person[1]!, viewer);
  return notFound();
}

/**
 * Just /{username} (as client/src/pages/PersonIndex.tsx chooses): the first of their lists this viewer may see (their
 * own, or public): journal, books, saved posts; else nothing. A temporary redirect, since it follows who's looking and
 * their privacy settings.
 */
async function personIndex(db: Pool, username: string, viewer: { id: number; role: string } | null): Promise<PageMeta> {
  const found = await findPerson(db, username);
  if (!found) return notFound();
  const me = viewer?.id === found.id;
  const first = PERSON_LISTS.find((list) => (me ? hasList(found, list) : isPublicList(found, list)));
  return first ? { ...notFound(), status: 302, redirect: `/${found.username}/${first}` } : notFound();
}
