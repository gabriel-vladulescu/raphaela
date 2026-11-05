// Kept free of imports: vite.config.ts uses it too, to give pages the same tags in development.

/** What a page gets before it's sent: see describePage(). */
export interface PageMeta {
  /** 404 for pages that don't exist (the app still loads and shows its "not found" page). */
  status: number;
  title: string;
  /** Tags for <head>: description, canonical, share tags, structured data. */
  head: string;
  /** HTML shown in #root until the app starts (a post's content, for search engines); '' for none. */
  root: string;
  /** Data the app can start with instead of fetching it (window.__PAGE_DATA__). */
  data: Record<string, unknown> | null;
  /** Who the site is and what every page needs (window.__SITE__, client/src/config.ts): set in the admin panel. */
  site?: { identity: { name: string } & Record<string, unknown>; settings: Record<string, unknown>; brand?: string } | null;
  /** A page that moved for good (a post's old address): where to (301). */
  redirect?: string;
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ENTITIES[c]!);

// U+2028 and U+2029 (line and paragraph separators), built here so the source has no literal ones.
const SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, 'g');

/** JSON that's safe inside a <script> element ("</script>" or "<!--" in the data can't end it early). */
export const scriptJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(SEPARATORS, (c) => `\\u${c.charCodeAt(0).toString(16)}`);

/** Puts a page's title, tags, initial HTML and data into index.html. */
export function injectPage(html: string, page: PageMeta) {
  // Functions as replacements, so "$" in the content is never read as a pattern.
  let out = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(page.title)}</title>`);
  out = out.replace('</head>', () => `${page.head}\n  </head>`);
  if (page.root) out = out.replace('<div id="root"></div>', () => `<div id="root">${page.root}</div>`);
  if (page.data) out = out.replace('</body>', () => `  <script>window.__PAGE_DATA__ = ${scriptJson(page.data)};</script>\n  </body>`);
  if (page.site) {
    // Before the app's scripts, which read it as they load; and the name where index.html has it (the splash).
    const name = escapeHtml(page.site.identity.name);
    out = out.replace('<head>', () => `<head>\n    <script>window.__SITE__ = ${scriptJson(page.site)};</script>`);
    out = out.replace(/(<p class="splash-name">)[\s\S]*?(<\/p>)/, (_m, open: string, close: string) => `${open}${name}${close}`);
    out = out.replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/, (_m, open: string, close: string) => `${open}${name}${close}`);
    // The current logo's version in the icons' addresses (an administrator may have changed the logo since the build).
    const brand = page.site.brand;
    if (brand) out = out.replace(/(\/icons\/[\w.-]+)\?v=[0-9a-f]{8}/g, (_m, file: string) => `${file}?v=${brand}`);
  }
  return out;
}
