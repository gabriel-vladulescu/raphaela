import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { summaryOf, TEXT_START, VISIBLE_POST } from '@/lib/posts';
import { pushTo } from '@/lib/push';
import type { PushMessage } from '@/lib/push';

// Notifications: in the app (the bell, /notificari) and, on the devices where an account turned it on, as push
// notifications. Each account picks what it hears about (users.notify_settings, the Settings page). By role:
// members hear about new posts and about replies and reactions to their own comments; authors also about what
// happens on their posts, and its milestones; administrators (owners) only about new support tickets, reported
// comments and deleted accounts waiting to be deleted for good.

export type NotificationType =
  | 'comment'
  | 'reply'
  | 'like'
  | 'share'
  | 'views'
  | 'new_post'
  | 'comment_reply'
  | 'comment_reaction'
  | 'post_reaction'
  | 'milestone'
  | 'support'
  | 'report'
  | 'account_due'
  | 'comment_held'
  | 'mention'
  | 'followed_post';

/** What a post's comments, likes and views are celebrated at. Comments count all of them: replies, and the
 *  author's own, too. */
export const MILESTONES = [1, 10, 50, 100, 1000] as const;
export const METRICS = ['comments', 'likes', 'views'] as const;
export type Metric = (typeof METRICS)[number];

/** What an account wants to hear about. */
export interface NotifySettings {
  /** Everyone: a new post goes up. */
  newPosts: boolean;
  /** Everyone: a reply to one of their comments. */
  myCommentReplies: boolean;
  /** Everyone: a reaction to one of their comments. */
  myCommentReactions: boolean;
  /** Authors, on their posts: likes, shares, comments, replies in the discussion, reactions to its comments. */
  postLikes: boolean;
  postShares: boolean;
  postComments: boolean;
  postReplies: boolean;
  postReactions: boolean;
  /** Authors: new views, one notification every `viewsEvery` of them. */
  views: boolean;
  viewsEvery: number;
  /** Authors: the milestones they want, per kind. */
  milestones: Record<Metric, number[]>;
  /** Administrators: a new support ticket. */
  support: boolean;
  /** Administrators: a comment was reported. */
  reports: boolean;
  /** Administrators: a deleted account's 3 months are up (to delete it for good). */
  accountDeletions: boolean;
  /** Administrators: a comment waits for approval (the comment filters). */
  heldComments: boolean;
  /** Everyone: someone wrote @their-username in a comment. */
  mentions: boolean;
  /** Everyone: an author they follow published a post (instead of the general "new post"). */
  followedAuthors: boolean;
}

export const DEFAULT_SETTINGS: NotifySettings = {
  newPosts: true,
  myCommentReplies: true,
  myCommentReactions: true,
  postLikes: true,
  postShares: true,
  postComments: true,
  postReplies: true,
  postReactions: true,
  views: true,
  viewsEvery: 10,
  milestones: { comments: [...MILESTONES], likes: [...MILESTONES], views: [...MILESTONES] },
  support: true,
  reports: true,
  accountDeletions: true,
  heldComments: true,
  mentions: true,
  followedAuthors: true,
};

const SWITCHES = [
  'newPosts',
  'myCommentReplies',
  'myCommentReactions',
  'postLikes',
  'postShares',
  'postComments',
  'postReplies',
  'postReactions',
  'views',
  'support',
  'reports',
  'accountDeletions',
  'heldComments',
  'mentions',
  'followedAuthors',
] as const;

/** Stored settings over the defaults; anything missing or malformed takes the default. */
export function readSettings(stored: unknown): NotifySettings {
  let value = stored;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const settings: NotifySettings = { ...DEFAULT_SETTINGS, milestones: { ...DEFAULT_SETTINGS.milestones } };
  if (!value || typeof value !== 'object') return settings;
  const given = value as Record<string, unknown>;
  for (const key of SWITCHES) if (typeof given[key] === 'boolean') settings[key] = given[key];
  const every = given.viewsEvery;
  if (typeof every === 'number' && Number.isInteger(every) && every >= 1 && every <= 100_000) settings.viewsEvery = every;
  const milestones = given.milestones as Record<string, unknown> | undefined;
  for (const metric of METRICS) {
    const list = milestones?.[metric];
    if (Array.isArray(list)) settings.milestones[metric] = MILESTONES.filter((m) => list.includes(m));
  }
  return settings;
}

interface Recipient {
  id: number;
  role: 'member' | 'author' | 'owner';
  settings: NotifySettings;
}

async function recipient(db: Pool, userId: number): Promise<Recipient | null> {
  // A deleted account hears about nothing.
  const [rows] = await db.execute<RowDataPacket[]>('SELECT id, role, notify_settings FROM users WHERE id = ? AND deleted_at IS NULL', [userId]);
  const row = rows[0];
  return row ? { id: row.id as number, role: row.role as Recipient['role'], settings: readSettings(row.notify_settings) } : null;
}

/** Which switch each kind follows. */
const SETTING: Partial<Record<NotificationType, (typeof SWITCHES)[number]>> = {
  comment: 'postComments',
  reply: 'postReplies',
  like: 'postLikes',
  share: 'postShares',
  views: 'views',
  new_post: 'newPosts',
  comment_reply: 'myCommentReplies',
  comment_reaction: 'myCommentReactions',
  post_reaction: 'postReactions',
  support: 'support',
  report: 'reports',
  account_due: 'accountDeletions',
  comment_held: 'heldComments',
  mention: 'mentions',
  followed_post: 'followedAuthors',
};
/** Only administrators hear about these (and administrators about nothing else). */
const OWNERS_ONLY = new Set<NotificationType>(['support', 'report', 'account_due', 'comment_held']);
/** About an author's own posts. */
const AUTHORS_ONLY = new Set<NotificationType>(['comment', 'reply', 'like', 'share', 'views', 'post_reaction', 'milestone']);

function wants(to: Recipient, event: Event) {
  if (to.role === 'owner' || OWNERS_ONLY.has(event.type)) return to.role === 'owner' && OWNERS_ONLY.has(event.type) && to.settings[SETTING[event.type]!];
  if (AUTHORS_ONLY.has(event.type) && to.role !== 'author') return false;
  if (event.type === 'milestone') return to.settings.milestones[event.detail as Metric]?.includes(event.value ?? 0) ?? false;
  const setting = SETTING[event.type];
  return setting ? to.settings[setting] : false;
}

interface PostRef {
  id: number;
  authorId: number;
  title: string;
  slug: string;
}

interface Event {
  type: NotificationType;
  post?: PostRef | null;
  commentId?: number | null;
  ticketId?: number | null;
  /** The account it's about (a deleted one waiting to be deleted for good). */
  accountId?: number | null;
  /** Who did it (null: a guest, or nobody). */
  actorId?: number | null;
  /** Shares: the app; reactions: the emoji; milestones: the metric. */
  detail?: string | null;
  /** Views: the count; milestones: the threshold. */
  value?: number | null;
  /** The text under the push's title (a comment's beginning, a ticket's sender). */
  excerpt?: string;
  /** One notification while it's unread, counting up: per post (likes, shares, reactions on a post's
   *  comments) or per comment (reactions to one's comment). */
  group?: 'post' | 'comment';
  /** Another title for the push (support tickets). */
  title?: string;
}

async function postRef(db: Pool, postId: number): Promise<PostRef | null> {
  const [rows] = await db.execute<RowDataPacket[]>('SELECT id, author_id, title, slug FROM posts WHERE id = ? AND deleted_at IS NULL', [postId]);
  const row = rows[0];
  return row ? { id: row.id as number, authorId: row.author_id as number, title: row.title as string, slug: row.slug as string } : null;
}

/** "10 comentarii", "50 de comentarii" (Romanian: "de" from 20 on, for the last two digits). */
function count(n: number, noun: string) {
  const number = new Intl.NumberFormat('ro-RO').format(n);
  return n % 100 >= 1 && n % 100 <= 19 ? `${number} ${noun}` : `${number} de ${noun}`;
}

/** Share sheet picks (events `share:<app>`), as push texts name them. */
const SHARE_APPS: Record<string, string> = {
  whatsapp: 'pe WhatsApp',
  facebook: 'pe Facebook',
  instagram: 'pe Instagram',
  x: 'pe X',
  telegram: 'pe Telegram',
  pinterest: 'pe Pinterest',
  email: 'pe email',
  copy: '(link copiat)',
  native: '',
};

function pushMessage(event: Event, actor: string | null): PushMessage {
  const who = actor ?? 'Cineva';
  const post = event.post;
  const title = post ? `„${post.title}”` : '';
  const discussion = post ? `/posts/${post.slug}#discussion-title` : '/notificari';
  switch (event.type) {
    case 'comment':
      return { title: `${who} a comentat la ${title}`, body: event.excerpt ?? '', url: discussion, tag: `comment-${event.commentId}` };
    case 'reply':
      return { title: `${who} a răspuns în discuția de la ${title}`, body: event.excerpt ?? '', url: discussion, tag: `comment-${event.commentId}` };
    case 'comment_reply':
      return { title: `${who} a răspuns la comentariul tău`, body: event.excerpt ?? '', url: discussion, tag: `comment-${event.commentId}` };
    case 'comment_reaction':
      return { title: `${who} a reacționat ${event.detail ?? ''} la comentariul tău`, body: event.excerpt ?? '', url: discussion, tag: `reaction-${event.commentId}` };
    case 'post_reaction':
      return { title: `${who} a reacționat ${event.detail ?? ''} la un comentariu de la ${title}`, body: '', url: discussion, tag: `reactions-${post?.id}` };
    case 'like':
      return { title: `${who} a apreciat ${title}`, body: 'Vezi toate notificările', url: '/notificari', tag: `like-${post?.id}` };
    case 'share':
      return { title: `${who} a distribuit ${title}`, body: SHARE_APPS[event.detail ?? ''] ?? '', url: '/notificari', tag: `share-${post?.id}` };
    case 'views':
      return { title: `${title} a ajuns la ${count(event.value ?? 0, 'vizualizări')}`, body: '', url: `/posts/${post?.slug}`, tag: `views-${post?.id}` };
    case 'milestone': {
      const n = event.value ?? 0;
      const text =
        event.detail === 'comments'
          ? n === 1
            ? 'a primit primul comentariu'
            : `a ajuns la ${count(n, 'comentarii')}`
          : event.detail === 'likes'
            ? n === 1
              ? 'a primit prima apreciere'
              : `a ajuns la ${count(n, 'aprecieri')}`
            : n === 1
              ? 'are prima vizualizare'
              : `a ajuns la ${count(n, 'vizualizări')}`;
      return { title: `${title} ${text} 🎉`, body: 'Felicitări!', url: `/posts/${post?.slug}`, tag: `milestone-${post?.id}-${event.detail}-${n}` };
    }
    case 'new_post':
      return { title: `Articol nou: ${post?.title ?? ''}`, body: event.excerpt ?? '', url: `/posts/${post?.slug}`, tag: `post-${post?.id}` };
    case 'support':
      return { title: event.title ?? 'Tichet nou la suport', body: event.excerpt ?? '', url: `/admin/suport/${event.ticketId}`, tag: `support-${event.ticketId}` };
    case 'report':
      return { title: `Comentariu raportat la ${title}`, body: event.excerpt ?? '', url: '/admin/comentarii?filter=reported', tag: `report-${event.commentId}` };
    case 'comment_held':
      return { title: `Un comentariu așteaptă aprobarea la ${title}`, body: event.excerpt ?? '', url: '/admin/comentarii?filter=held', tag: `held-${event.commentId}` };
    case 'mention':
      return { title: `${who} te-a menționat la ${title}`, body: event.excerpt ?? '', url: discussion, tag: `mention-${event.commentId}` };
    case 'followed_post':
      return { title: `${who} a publicat: ${post?.title ?? ''}`, body: event.excerpt ?? '', url: `/posts/${post?.slug}`, tag: `post-${post?.id}` };
    case 'account_due':
      return {
        title: event.title ?? 'Un cont așteaptă ștergerea definitivă',
        body: 'Cele 3 luni au trecut. Vezi ce a ales persoana, în administrare.',
        url: `/admin/utilizatori?status=deleted&id=${event.accountId}`,
        tag: `account-${event.accountId}`,
      };
  }
}

/**
 * Tells one account that something happened, if they want to hear about it: in the app, and pushed to their devices
 * with push on. Never about what they did themselves. Grouped kinds add to their unread notification instead of
 * starting a new one (the first one pushes, the next ones don't). Never throws.
 */
async function notify(db: Pool, userId: number, event: Event): Promise<boolean> {
  try {
    if (event.actorId && event.actorId === userId) return false;
    const to = await recipient(db, userId);
    if (!to || !wants(to, event)) return false;
    const postId = event.post?.id ?? null;

    if (event.group) {
      const [grouped] = await db.execute<ResultSetHeader>(
        `UPDATE notifications SET times = times + 1, actor_id = ?, detail = COALESCE(?, detail), created_at = UTC_TIMESTAMP()
          WHERE user_id = ? AND type = ? AND read_at IS NULL AND ${event.group === 'post' ? 'post_id = ?' : 'comment_id = ?'}
          ORDER BY id DESC LIMIT 1`,
        [event.actorId ?? null, event.detail ?? null, userId, event.type, event.group === 'post' ? postId : (event.commentId ?? null)],
      );
      if (grouped.affectedRows > 0) return true;
    }

    await db.execute(
      `INSERT INTO notifications (user_id, type, post_id, comment_id, ticket_id, account_id, actor_id, detail, value, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [
        userId,
        event.type,
        postId,
        event.commentId ?? null,
        event.ticketId ?? null,
        event.accountId ?? null,
        event.actorId ?? null,
        event.detail ?? null,
        event.value ?? null,
      ],
    );
    const [actors] = event.actorId ? await db.execute<RowDataPacket[]>('SELECT name FROM users WHERE id = ? AND deleted_at IS NULL', [event.actorId]) : [[]];
    const actor = (actors[0]?.name as string | undefined) ?? null;
    await pushTo(db, 'user_id = ? AND activity = 1', [userId], pushMessage(event, actor));
    return true;
  } catch (err) {
    console.warn('Notification failed:', (err as Error).message);
    return false;
  }
}

/** The usernames written as @username in a comment (at most 10). */
export function mentionedUsernames(body: string) {
  const names = new Set<string>();
  for (const match of body.matchAll(/(?:^|[^\w.@])@([a-z0-9]+(?:\.[a-z0-9]+)*)/gi)) {
    names.add(match[1]!.toLowerCase());
    if (names.size >= 10) break;
  }
  return [...names];
}

/** A milestone, once per post, metric and threshold (counts can drop and rise again). */
async function milestone(db: Pool, post: PostRef, metric: Metric, total: number) {
  if (!(MILESTONES as readonly number[]).includes(total)) return false;
  const [seen] = await db.execute<RowDataPacket[]>(
    "SELECT 1 FROM notifications WHERE user_id = ? AND type = 'milestone' AND post_id = ? AND detail = ? AND value = ? LIMIT 1",
    [post.authorId, post.id, metric, total],
  );
  if (seen.length) return false;
  await notify(db, post.authorId, { type: 'milestone', post, detail: metric, value: total });
  return true;
}

/**
 * A comment on a post: the post's author hears about it (a comment, or a reply in its discussion), the person
 * replied to too (a reply to their comment), and the post's comments may reach a milestone.
 */
export async function notifyComment(db: Pool, input: { postId: number; commentId: number; actorId: number; parentId: number | null; body: string }) {
  const excerpt = input.body.slice(0, 140);
  try {
    const post = await postRef(db, input.postId);
    if (!post) return;
    let repliedTo: number | null = null;
    if (input.parentId) {
      const [rows] = await db.execute<RowDataPacket[]>('SELECT user_id FROM comments WHERE id = ?', [input.parentId]);
      repliedTo = (rows[0]?.user_id as number | undefined) ?? null;
    }
    const base = { post, commentId: input.commentId, actorId: input.actorId, excerpt };
    if (repliedTo) await notify(db, repliedTo, { ...base, type: 'comment_reply' });
    // The author replied to (above) already heard about it.
    if (post.authorId !== repliedTo) await notify(db, post.authorId, { ...base, type: input.parentId ? 'reply' : 'comment' });
    // Everyone else written as @username (the two above already heard about it).
    const names = mentionedUsernames(input.body);
    if (names.length) {
      const [mentioned] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE username IN (?) AND deleted_at IS NULL', [names]);
      for (const row of mentioned) {
        const id = row.id as number;
        if (id !== repliedTo && id !== post.authorId) await notify(db, id, { ...base, type: 'mention' });
      }
    }
    const [[row]] = await db.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND deleted_at IS NULL', [post.id]);
    await milestone(db, post, 'comments', Number(row!.n));
  } catch (err) {
    console.warn('Comment notification failed:', (err as Error).message);
  }
}

/** A reaction to a comment: its writer hears about it, and the post's author (reactions in their discussion). */
export async function notifyReaction(db: Pool, input: { commentId: number; actorId: number; emoji: string }) {
  try {
    const [rows] = await db.execute<RowDataPacket[]>('SELECT user_id, post_id, body FROM comments WHERE id = ?', [input.commentId]);
    const comment = rows[0];
    if (!comment) return;
    const post = await postRef(db, comment.post_id as number);
    if (!post) return;
    const writer = comment.user_id as number;
    const base = { post, commentId: input.commentId, actorId: input.actorId, detail: input.emoji };
    await notify(db, writer, { ...base, type: 'comment_reaction', group: 'comment', excerpt: String(comment.body).slice(0, 140) });
    if (post.authorId !== writer) await notify(db, post.authorId, { ...base, type: 'post_reaction', group: 'post' });
  } catch (err) {
    console.warn('Reaction notification failed:', (err as Error).message);
  }
}

/** A like on a post: its author hears about it, and its likes may reach a milestone. */
export async function notifyLike(db: Pool, input: { postId: number; actorId: number | null }) {
  try {
    const post = await postRef(db, input.postId);
    if (!post) return;
    await notify(db, post.authorId, { type: 'like', post, actorId: input.actorId, group: 'post' });
    const [[row]] = await db.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ? AND removed_at IS NULL', [post.id]);
    await milestone(db, post, 'likes', Number(row!.n));
  } catch (err) {
    console.warn('Like notification failed:', (err as Error).message);
  }
}

/** A share (from the share sheet): the post's author hears about it. */
export async function notifyShare(db: Pool, input: { postId: number; actorId: number | null; app: string }) {
  const post = await postRef(db, input.postId).catch(() => null);
  if (post) await notify(db, post.authorId, { type: 'share', post, actorId: input.actorId, detail: input.app, group: 'post' });
}

/** A new view (one per visitor and day): a milestone, or else every N views as the author chose. */
export async function notifyViews(db: Pool, input: { postId: number; total: number }) {
  try {
    const post = await postRef(db, input.postId);
    if (!post) return;
    if (await milestone(db, post, 'views', input.total)) return;
    const to = await recipient(db, post.authorId);
    if (to && input.total % to.settings.viewsEvery === 0) await notify(db, post.authorId, { type: 'views', post, value: input.total });
  } catch (err) {
    console.warn('Views notification failed:', (err as Error).message);
  }
}

/** Every administrator account (they hear about support, reports and accounts to delete). */
async function owners(db: Pool) {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT id FROM users WHERE role = 'owner' AND deleted_at IS NULL");
  return rows.map((row) => row.id as number);
}

/** A reported comment: administrators hear about it, once per comment while unread (more reports count up). */
export async function notifyReport(db: Pool, input: { commentId: number; postId: number; reporterId: number; reason: string; excerpt: string }) {
  try {
    const post = await postRef(db, input.postId);
    for (const id of await owners(db)) {
      await notify(db, id, {
        type: 'report',
        post,
        commentId: input.commentId,
        actorId: input.reporterId,
        detail: input.reason,
        excerpt: input.excerpt,
        group: 'comment',
      });
    }
  } catch (err) {
    console.warn('Report notification failed:', (err as Error).message);
  }
}

/** A comment the filters held: administrators hear it waits for their approval. */
export async function notifyHeld(db: Pool, input: { commentId: number; postId: number; actorId: number; excerpt: string }) {
  try {
    const post = await postRef(db, input.postId);
    for (const id of await owners(db)) {
      await notify(db, id, { type: 'comment_held', post, commentId: input.commentId, actorId: input.actorId, excerpt: input.excerpt });
    }
  } catch (err) {
    console.warn('Held comment notification failed:', (err as Error).message);
  }
}

/** A deleted account's 3 months are up: administrators hear they can delete it for good (lib/accounts.ts). */
export async function notifyAccountDue(db: Pool, input: { accountId: number; name: string }) {
  try {
    for (const id of await owners(db)) {
      await notify(db, id, { type: 'account_due', accountId: input.accountId, title: `Cont de șters definitiv: ${input.name}` });
    }
  } catch (err) {
    console.warn('Account notification failed:', (err as Error).message);
  }
}

/** A new support ticket: the administrators hear about it. */
export async function notifySupport(db: Pool, ticket: { id: number; title: string; email: string; userId: number | null }) {
  try {
    for (const owner of await owners(db)) {
      await notify(db, owner, {
        type: 'support',
        ticketId: ticket.id,
        actorId: ticket.userId,
        title: `Tichet nou la suport: ${ticket.title}`,
        excerpt: ticket.email,
      });
    }
  } catch (err) {
    console.warn('Support notification failed:', (err as Error).message);
  }
}

/** A post is new news for this long after it went public; older ones aren't announced (see announceNewPosts). */
const ANNOUNCE_DAYS = 7;

/**
 * New posts, once they're public (published now, or a scheduled time that has come), announced once: in the app to
 * the accounts that want to hear about them (and pushed to their devices with push on), and pushed to the signed-out
 * devices that asked for them (the bell's switch). Runs every minute (index.ts).
 */
export async function announceNewPosts(db: Pool) {
  try {
    // Posts that went public long ago and were never announced (imported, or from before announcing existed) are
    // old news: marked as announced, without telling anyone.
    await db.query(
      `UPDATE posts p SET p.announced_at = UTC_TIMESTAMP(), p.newsletter_at = COALESCE(p.newsletter_at, UTC_TIMESTAMP())
        WHERE p.announced_at IS NULL AND ${VISIBLE_POST} AND p.published_at < UTC_TIMESTAMP() - INTERVAL ${ANNOUNCE_DAYS} DAY`,
    );
    const [posts] = await db.query<RowDataPacket[]>(
      `SELECT p.id, p.author_id, p.title, p.slug, p.excerpt, ${TEXT_START} FROM posts p WHERE p.announced_at IS NULL AND ${VISIBLE_POST}`,
    );
    for (const row of posts) {
      // Claimed first, so a post is never announced twice.
      const [claimed] = await db.execute<ResultSetHeader>('UPDATE posts SET announced_at = UTC_TIMESTAMP() WHERE id = ? AND announced_at IS NULL', [row.id]);
      if (claimed.affectedRows === 0) continue;
      const post: PostRef = { id: row.id as number, authorId: row.author_id as number, title: row.title as string, slug: row.slug as string };
      const summary = summaryOf(row);
      const [readers] = await db.execute<RowDataPacket[]>("SELECT id FROM users WHERE role IN ('member', 'author') AND id <> ? AND deleted_at IS NULL", [post.authorId]);
      const [follows] = await db.execute<RowDataPacket[]>('SELECT user_id FROM author_follows WHERE author_id = ?', [post.authorId]);
      const followers = new Set(follows.map((f) => f.user_id as number));
      for (const reader of readers) {
        const id = reader.id as number;
        // Those who follow the author hear it as such; if they turned that off, as any new post.
        const told = followers.has(id) && (await notify(db, id, { type: 'followed_post', post, actorId: post.authorId, excerpt: summary }));
        if (!told) await notify(db, id, { type: 'new_post', post, actorId: post.authorId, excerpt: summary });
      }
      // The newsletter takes it from here (lib/newsletter.ts).
      await db.execute('UPDATE posts SET newsletter_at = COALESCE(newsletter_at, UTC_TIMESTAMP()) WHERE id = ?', [post.id]);
      await pushTo(db, 'new_posts = 1 AND user_id IS NULL', [], pushMessage({ type: 'new_post', post, excerpt: summary }, null));
    }
  } catch (err) {
    console.warn('Announcing new posts failed:', (err as Error).message);
  }
}
