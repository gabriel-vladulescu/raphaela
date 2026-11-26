import type { FastifyPluginAsync } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { siteDay, siteDayStart } from '@/lib/analytics';
import { requireWriter } from '@/lib/guards';
import { postPath } from '@/lib/posts';

const DAY_MS = 86_400_000;
const num = (value: unknown) => Number(value ?? 0);
const avgOrNull = (value: unknown) => (value === null || value === undefined ? null : Math.round(Number(value)));

/**
 * The statistics: the whole site for owners (the admin dashboard), who can also narrow it to one author's posts
 * (`author`), and for authors the same numbers for their own posts only; each also to the journal's articles or the
 * books' chapters only (`kind`). Narrowed (to an author or a kind), there are no other pages and no community. Views, reading time and how far people read come from page_views; shares, saves and the
 * reading time before a like or a comment from events (both recorded by the browser, one row per visitor, page and
 * day); likes and comments from their own tables.
 */
const statsRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app;

  app.get<{ Querystring: { days: 7 | 30 | 90; author?: number; kind: 'all' | 'posts' | 'chapters' } }>(
    '/stats',
    {
      preHandler: requireWriter,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'integer', enum: [7, 30, 90], default: 30 },
            author: { type: 'integer', minimum: 1 },
            kind: { type: 'string', enum: ['all', 'posts', 'chapters'], default: 'all' },
          },
        },
      },
    },
    async (req) => {
      const { days, kind } = req.query;
      const to = siteDay();
      const from = siteDay(new Date(Date.now() - (days - 1) * DAY_MS));
      const fromUtc = siteDayStart(from);
      const toUtc = new Date(siteDayStart(to).getTime() + DAY_MS);

      // Owners: everyone who has written a post, to narrow the statistics to one of them.
      const mine = req.user!.role !== 'owner';
      const [authorRows] = mine
        ? [[] as RowDataPacket[]]
        : await db.query<RowDataPacket[]>(
            `SELECT u.id, u.name, COUNT(*) AS posts FROM users u JOIN posts p ON p.author_id = u.id
              GROUP BY u.id, u.name ORDER BY u.name`,
          );
      const authors = authorRows.map((row) => ({ id: row.id as number, name: row.name as string, posts: num(row.posts) }));

      // One author's posts (an author's own, or the one an owner picked; someone without posts means the whole
      // site), the journal's articles or the books' chapters: every table narrowed to them (each has a post_id).
      const author = mine ? { id: req.user!.id, name: req.user!.name } : (authors.find((a) => a.id === req.query.author) ?? null);
      const authorId = author?.id ?? null;
      const ofKind = kind === 'posts' ? ' AND book_id IS NULL' : kind === 'chapters' ? ' AND book_id IS NOT NULL' : '';
      const narrowed = authorId !== null || kind !== 'all';
      const scope = narrowed ? ` AND post_id IN (SELECT id FROM posts WHERE 1 = 1${authorId ? ' AND author_id = ?' : ''}${ofKind})` : '';
      const scoped = (params: unknown[]) => (authorId ? [...params, authorId] : params);
      const range = scoped([from, to]);

      // The period's totals; the same for the one before it (as long), to show what changed.
      const totalsFor = async (first: string, last: string, firstUtc: Date, endUtc: Date) => {
        const days = scoped([first, last]);
        const times = scoped([firstUtc, endUtc]);
        const [[views]] = await db.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS page_views, SUM(post_id IS NOT NULL) AS post_views, COUNT(DISTINCT visitor_id) AS visitors,
                  AVG(CASE WHEN post_id IS NOT NULL THEN active_seconds END) AS avg_seconds,
                  AVG(CASE WHEN post_id IS NOT NULL THEN max_scroll >= 90 END) AS read_through
             FROM page_views WHERE day BETWEEN ? AND ?${scope}`,
          days,
        );
        const [[likes]] = await db.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM post_likes WHERE created_at >= ? AND created_at < ? AND removed_at IS NULL${scope}`,
          times,
        );
        const [[comments]] = await db.query<RowDataPacket[]>(
          `SELECT SUM(parent_id IS NULL) AS comments, SUM(parent_id IS NOT NULL) AS replies
             FROM comments WHERE created_at >= ? AND created_at < ? AND deleted_at IS NULL${scope}`,
          times,
        );
        const [[actions]] = await db.query<RowDataPacket[]>(
          `SELECT SUM(action LIKE 'share:%') AS shares, SUM(action = 'save') AS saves,
                  AVG(CASE WHEN action = 'like' THEN first_seconds END) AS seconds_to_like,
                  AVG(CASE WHEN action IN ('comment', 'reply') THEN first_seconds END) AS seconds_to_comment
             FROM events WHERE day BETWEEN ? AND ?${scope}`,
          days,
        );
        return {
          pageViews: num(views!.page_views),
          postViews: num(views!.post_views),
          visitors: num(views!.visitors),
          avgSeconds: Math.round(num(views!.avg_seconds)),
          readThrough: Math.round(num(views!.read_through) * 100),
          likes: num(likes!.n),
          comments: num(comments!.comments),
          replies: num(comments!.replies),
          shares: num(actions!.shares),
          saves: num(actions!.saves),
          secondsToLike: avgOrNull(actions!.seconds_to_like),
          secondsToComment: avgOrNull(actions!.seconds_to_comment),
        };
      };
      const totals = await totalsFor(from, to, fromUtc, toUtc);
      const previousFromUtc = new Date(fromUtc.getTime() - days * DAY_MS);
      const previous = await totalsFor(siteDay(new Date(previousFromUtc.getTime() + DAY_MS / 2)), siteDay(new Date(fromUtc.getTime() - DAY_MS / 2)), previousFromUtc, fromUtc);

      const [dailyRows] = await db.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
           FROM page_views WHERE day BETWEEN ? AND ?${scope} GROUP BY day`,
        range,
      );
      const byDay = new Map(dailyRows.map((row) => [row.day as string, row]));
      const daily = Array.from({ length: days }, (_, i) => {
        const day = siteDay(new Date(fromUtc.getTime() + i * DAY_MS + DAY_MS / 2));
        const row = byDay.get(day);
        return { day, views: num(row?.views), visitors: num(row?.visitors) };
      });

      // Posts: the most viewed in the period, with what readers did there.
      const [postRows] = await db.query<RowDataPacket[]>(
        `SELECT p.id, p.title, p.slug, bk.slug AS book_slug, COUNT(*) AS views, COUNT(DISTINCT v.visitor_id) AS visitors,
                AVG(v.active_seconds) AS avg_seconds, AVG(v.max_scroll >= 90) AS read_through
           FROM page_views v JOIN posts p ON p.id = v.post_id LEFT JOIN books bk ON bk.id = p.book_id
          WHERE v.day BETWEEN ? AND ?${scope}
          GROUP BY p.id, p.title, p.slug, bk.slug
          ORDER BY views DESC, p.id DESC
          LIMIT 50`,
        range,
      );
      const ids = postRows.map((row) => row.id as number);
      const perPost = async (sql: string, params: unknown[]) => {
        if (ids.length === 0) return new Map<number, RowDataPacket>();
        const [rows] = await db.query<RowDataPacket[]>(sql, [...params, ids]);
        return new Map(rows.map((row) => [row.post_id as number, row]));
      };
      const postLikes = await perPost(
        'SELECT post_id, COUNT(*) AS n FROM post_likes WHERE created_at >= ? AND created_at < ? AND removed_at IS NULL AND post_id IN (?) GROUP BY post_id',
        [fromUtc, toUtc],
      );
      const postComments = await perPost(
        'SELECT post_id, COUNT(*) AS n FROM comments WHERE created_at >= ? AND created_at < ? AND deleted_at IS NULL AND post_id IN (?) GROUP BY post_id',
        [fromUtc, toUtc],
      );
      const postEvents = await perPost(
        `SELECT post_id, SUM(action LIKE 'share:%') AS shares, SUM(action = 'save') AS saves,
                AVG(CASE WHEN action = 'like' THEN first_seconds END) AS seconds_to_like,
                AVG(CASE WHEN action IN ('comment', 'reply') THEN first_seconds END) AS seconds_to_comment
           FROM events WHERE day BETWEEN ? AND ? AND post_id IN (?) GROUP BY post_id`,
        range,
      );
      const posts = postRows.map((row) => {
        const id = row.id as number;
        const events = postEvents.get(id);
        return {
          id,
          title: row.title as string,
          slug: row.slug as string,
          /** Where it's read (a chapter: under its book). */
          path: postPath(row.slug as string, (row.book_slug as string | null) ?? null),
          views: num(row.views),
          visitors: num(row.visitors),
          avgSeconds: Math.round(num(row.avg_seconds)),
          readThrough: Math.round(num(row.read_through) * 100),
          likes: num(postLikes.get(id)?.n),
          comments: num(postComments.get(id)?.n),
          shares: num(events?.shares),
          saves: num(events?.saves),
          secondsToLike: avgOrNull(events?.seconds_to_like),
          secondsToComment: avgOrNull(events?.seconds_to_comment),
        };
      });

      // Buttons and share picks; where visits come from; on what.
      const [actionRows] = await db.query<RowDataPacket[]>(
        `SELECT action, SUM(times) AS times, COUNT(DISTINCT visitor_id) AS visitors
           FROM events WHERE day BETWEEN ? AND ?${scope} GROUP BY action ORDER BY times DESC`,
        range,
      );
      const [referrerRows] = await db.query<RowDataPacket[]>(
        `SELECT referrer AS host, COUNT(*) AS views
           FROM page_views WHERE day BETWEEN ? AND ?${scope} GROUP BY referrer ORDER BY views DESC LIMIT 10`,
        range,
      );
      const [deviceRows] = await db.query<RowDataPacket[]>(
        `SELECT device, COUNT(*) AS views FROM page_views WHERE day BETWEEN ? AND ?${scope} GROUP BY device ORDER BY views DESC`,
        range,
      );
      // The site's other pages, and its community: the whole site's statistics only.
      const [pageRows] = narrowed
        ? [[] as RowDataPacket[]]
        : await db.query<RowDataPacket[]>(
            `SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
               FROM page_views WHERE day BETWEEN ? AND ? AND post_id IS NULL GROUP BY path ORDER BY views DESC LIMIT 10`,
            range,
          );

      // The community: accounts, devices with notifications on, and what the history tables hold (likes taken back,
      // comments deleted or edited, reactions given).
      const between = [fromUtc, toUtc];
      const [communityRows] = narrowed
        ? [[] as RowDataPacket[]]
        : await db.query<RowDataPacket[]>(
            `SELECT (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL) AS accounts,
                    (SELECT COUNT(*) FROM users WHERE role <> 'member' AND deleted_at IS NULL) AS writers,
                    (SELECT COUNT(*) FROM users WHERE created_at >= ? AND created_at < ?) AS new_accounts,
                    (SELECT COUNT(*) FROM push_subscriptions WHERE new_posts = 1) AS push_readers,
                    (SELECT COUNT(*) FROM push_subscriptions WHERE activity = 1) AS push_writers,
                    (SELECT COUNT(*) FROM comment_reactions WHERE created_at >= ? AND created_at < ?) AS reactions,
                    (SELECT COUNT(*) FROM post_likes WHERE removed_at >= ? AND removed_at < ?) AS likes_taken_back,
                    (SELECT COUNT(*) FROM comments WHERE deleted_at >= ? AND deleted_at < ?) AS comments_deleted,
                    (SELECT COUNT(*) FROM comment_revisions WHERE replaced_at >= ? AND replaced_at < ?) AS comment_edits`,
            [...between, ...between, ...between, ...between, ...between],
          );
      const community = communityRows[0];

      return {
        days,
        kind,
        from,
        to,
        mine,
        /** Whose posts these are, when narrowed to one author. */
        author: author && { id: author.id, name: author.name },
        /** Owners: the authors to choose from. */
        authors: mine ? null : authors,
        totals,
        /** The period before, as long: what the totals are compared with. */
        previous,
        daily,
        posts,
        actions: actionRows.map((row) => ({ action: row.action as string, times: num(row.times), visitors: num(row.visitors) })),
        referrers: referrerRows.map((row) => ({ host: (row.host as string | null) ?? null, views: num(row.views) })),
        devices: deviceRows.map((row) => ({ device: row.device as string, views: num(row.views) })),
        pages: pageRows.map((row) => ({ path: row.path as string, views: num(row.views), visitors: num(row.visitors) })),
        community: community
          ? {
              accounts: num(community.accounts),
              writers: num(community.writers),
              newAccounts: num(community.new_accounts),
              pushReaders: num(community.push_readers),
              pushWriters: num(community.push_writers),
              reactions: num(community.reactions),
              likesTakenBack: num(community.likes_taken_back),
              commentsDeleted: num(community.comments_deleted),
              commentEdits: num(community.comment_edits),
            }
          : null,
      };
    },
  );
};

export default statsRoutes;
