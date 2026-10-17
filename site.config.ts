/**
 * Site-wide settings, edited here only. The client reads them (tab titles, footer, index.html) and so does the
 * server (search engine tags, share images, sitemap, RSS feed). The public address is APP_URL in server/.env.
 */
export const site = {
  name: 'Raphaela',
  /** Copyright holder: the footer and, on narrow screens, the account sheet ("© Raphaela.ro 2026"). */
  company: 'Raphaela.ro',
  /** The home page's description in search results and link previews. */
  description: 'Horoscop, zodii, fazele Lunii și astrologie, explicate pe înțelesul tuturor.',
  /** The posts' language (the interface can also be English, the articles are Romanian). */
  language: 'ro',
  locale: 'ro_RO',
  timeZone: 'Europe/Bucharest',
} as const;
