import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { site } from '@/lib/siteIdentity';
import { siteSettings } from '@/lib/siteSettings';
import { summaryOf, TEXT_START, VISIBLE_POST } from '@/lib/posts';
import { shareImagePath } from '@/seo/og';
import { siteOrigin } from '@/seo/page';

// For search engines and feed readers, at the site's root: robots.txt, sitemap.xml (every published post, with when
// it last changed and its banner) and rss.xml (the latest posts). Submit the sitemap in Google Search Console.

const xml = (text: string) => text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
const absolute = (url: string) => (/^https?:\/\//.test(url) ? url : `${siteOrigin()}${url}`);

const feedRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get('/robots.txt', async (_req, reply) => {
    const body = ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /editor/', 'Disallow: /resetare-parola', 'Disallow: /confirmare-email', 'Disallow: /*/articole/', '', `Sitemap: ${siteOrigin()}/sitemap.xml`, ''].join('\n');
    return reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=3600').send(body);
  });

  // Closed for maintenance: the posts aren't listed either (search engines come back later, as the pages tell them).
  const closed = () => siteSettings().maintenance;

  app.get('/sitemap.xml', async (_req, reply) => {
    if (closed()) return reply.code(503).header('Retry-After', '3600').type('text/plain; charset=utf-8').send('Maintenance');
    const origin = siteOrigin();
    const [posts] = await db.query<RowDataPacket[]>(
      `SELECT p.slug, p.title, p.banner_url, p.updated_at FROM posts p WHERE ${VISIBLE_POST} ORDER BY p.published_at DESC`,
    );
    // Tags with public posts (each has its page).
    const [tags] = await db.query<RowDataPacket[]>(
      `SELECT t.slug, MAX(p.updated_at) AS updated_at
         FROM tags t JOIN post_tags pt ON pt.tag_id = t.id JOIN posts p ON p.id = pt.post_id AND ${VISIBLE_POST}
        GROUP BY t.slug`,
    );
    const [categories] = await db.query<RowDataPacket[]>(
      `SELECT c.slug, MAX(p.updated_at) AS updated_at
         FROM categories c JOIN posts p ON p.category_id = c.id AND ${VISIBLE_POST}
        GROUP BY c.id, c.slug`,
    );
    const lastmod = (date: Date | null) => (date ? `<lastmod>${new Date(date).toISOString()}</lastmod>` : '');
    const urls = [
      `<url><loc>${origin}/</loc>${lastmod(posts[0]?.updated_at ?? null)}</url>`,
      ...posts.map(
        (post) =>
          `<url><loc>${xml(`${origin}/posts/${post.slug}`)}</loc>${lastmod(post.updated_at)}` +
          (post.banner_url ? `<image:image><image:loc>${xml(absolute(post.banner_url))}</image:loc></image:image>` : '') +
          '</url>',
      ),
      ...categories.map((category) => `<url><loc>${xml(`${origin}/?category=${encodeURIComponent(category.slug)}`)}</loc>${lastmod(category.updated_at)}</url>`),
      ...tags.map((tag) => `<url><loc>${xml(`${origin}/eticheta/${encodeURIComponent(tag.slug)}`)}</loc>${lastmod(tag.updated_at)}</url>`),
      `<url><loc>${origin}/termeni-si-conditii</loc></url>`,
    ];
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>
`;
    return reply.type('application/xml; charset=utf-8').header('Cache-Control', 'public, max-age=900').send(body);
  });

  app.get('/rss.xml', async (_req, reply) => {
    if (closed()) return reply.code(503).header('Retry-After', '3600').type('text/plain; charset=utf-8').send('Maintenance');
    const origin = siteOrigin();
    const [posts] = await db.query<RowDataPacket[]>(
      `SELECT p.id, p.slug, p.title, p.excerpt, ${TEXT_START}, p.banner_url, p.published_at, u.name AS author_name, c.name AS category_name
         FROM posts p JOIN users u ON u.id = p.author_id LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${VISIBLE_POST} ORDER BY p.published_at DESC LIMIT 30`,
    );
    const items = posts.map((post) => {
      const link = xml(`${origin}/posts/${post.slug}`);
      return `    <item>
      <title>${xml(post.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${new Date(post.published_at).toUTCString()}</pubDate>
      <dc:creator>${xml(post.author_name)}</dc:creator>${post.category_name ? `\n      <category>${xml(post.category_name)}</category>` : ''}
      <description>${xml(summaryOf(post))}</description>
      <media:content url="${xml(absolute(shareImagePath(post)))}" medium="image" type="image/jpeg" width="1200" height="630"/>
    </item>`;
    });
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${xml(site.name)}</title>
    <link>${origin}/</link>
    <description>${xml(site.description)}</description>
    <language>${site.language}</language>
    <atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <image><url>${origin}/api/og/logo.png</url><title>${xml(site.name)}</title><link>${origin}/</link></image>
${items.join('\n')}
  </channel>
</rss>
`;
    return reply.type('application/rss+xml; charset=utf-8').header('Cache-Control', 'public, max-age=900').send(body);
  });
};

export default feedRoutes;
