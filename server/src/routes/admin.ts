import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { siteDay } from '@/lib/analytics';
import { requireOwner } from '@/lib/guards';

const DAY_MS = 24 * 60 * 60 * 1000;
const num = (value: unknown) => Number(value ?? 0);

/** The administration hub (/admin): a few numbers for each of its sections. */
const adminRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get('/admin/overview', { preHandler: requireOwner }, async () => {
    const weekFrom = siteDay(new Date(Date.now() - 6 * DAY_MS));
    const [[row]] = await db.query<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM support_tickets) AS tickets,
              (SELECT COUNT(*) FROM support_tickets WHERE seen_at IS NULL) AS tickets_new,
              (SELECT COUNT(*) FROM posts WHERE deleted_at IS NULL AND status = 'published' AND published_at <= UTC_TIMESTAMP()) AS published,
              (SELECT COUNT(*) FROM posts WHERE deleted_at IS NULL AND status = 'published' AND published_at > UTC_TIMESTAMP()) AS scheduled,
              (SELECT COUNT(*) FROM posts WHERE deleted_at IS NULL AND status = 'draft') AS drafts,
              (SELECT COUNT(*) FROM categories) AS categories,
              (SELECT COUNT(*) FROM categories WHERE parent_id IS NULL) AS top_categories,
              (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM users WHERE role = 'author') AS authors,
              (SELECT COUNT(*) FROM page_views WHERE day >= ?) AS week_views,
              (SELECT COUNT(DISTINCT visitor_id) FROM page_views WHERE day >= ?) AS week_visitors`,
      [weekFrom, weekFrom],
    );
    return {
      tickets: { total: num(row!.tickets), unseen: num(row!.tickets_new) },
      posts: { published: num(row!.published), scheduled: num(row!.scheduled), drafts: num(row!.drafts) },
      categories: { total: num(row!.categories), top: num(row!.top_categories) },
      users: { total: num(row!.users), authors: num(row!.authors) },
      week: { views: num(row!.week_views), visitors: num(row!.week_visitors) },
    };
  });
};

export default adminRoutes;
