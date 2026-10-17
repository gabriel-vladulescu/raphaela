import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { summaryOf, TEXT_START, VISIBLE_POST } from '@/lib/posts';
import { pushTo } from '@/lib/push';
import type { PushMessage } from '@/lib/push';

// Notifications: in the app (the bell, /notificari) and, on the devices where an account turned it on, as push
// notifications. Each account picks what it hears about (users.notify_settings, the Settings page). By role:
// members hear about new posts and about replies and reactions to their own comments; authors also about what
// happens on their posts, and its milestones; administrators (owners) only about new support tickets.

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
  | 'support';

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
  const [rows] = await db.execute<RowDataPacket[]>('SELECT id, role, notify_settings FROM users WHERE id = ?', [userId]);
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
};
/** About an author's own posts. */
const AUTHORS_ONLY = new Set<NotificationType>(['comment', 'reply', 'like', 'share', 'views', 'post_reaction', 'milestone']);

function wants(to: Recipient, event: Event) {
  if (to.role === 'owner') return event.type === 'support' && to.settings.support;
  if (event.type === 'support') return false;
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
  }
}

/**
 * Tells one account that something happened, if they want to hear about it: in the app, and pushed to their devices
 * with push on. Never about what they did themselves. Grouped kinds add to their unread notification instead of
 * starting a new one (the first one pushes, the next ones don't). Never throws.
 */
async function notify(db: Pool, userId: number, event: Event) {
  try {
    if (event.actorId && event.actorId === userId) return;
    const to = await recipient(db, userId);
    if (!to || !wants(to, event)) return;
    const postId = event.post?.id ?? null;

    if (event.group) {
      const [grouped] = await db.execute<ResultSetHeader>(
        `UPDATE notifications SET times = times + 1, actor_id = ?, detail = COALESCE(?, detail), created_at = UTC_TIMESTAMP()
          WHERE user_id = ? AND type = ? AND read_at IS NULL AND ${event.group === 'post' ? 'post_id = ?' : 'comment_id = ?'}
          ORDER BY id DESC LIMIT 1`,
        [event.actorId ?? null, event.detail ?? null, userId, event.type, event.group === 'post' ? postId : (event.commentId ?? null)],
      );
      if (grouped.affectedRows > 0) return;
    }

    await db.execute(
      `INSERT INTO notifications (user_id, type, post_id, comment_id, ticket_id, actor_id, detail, value, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [userId, event.type, postId, event.commentId ?? null, event.ticketId ?? null, event.actorId ?? null, event.detail ?? null, event.value ?? null],
    );
    const [actors] = event.actorId ? await db.execute<RowDataPacket[]>('SELECT name FROM users WHERE id = ?', [event.actorId]) : [[]];
    const actor = (actors[0]?.name as string | undefined) ?? null;
    await pushTo(db, 'user_id = ? AND activity = 1', [userId], pushMessage(event, actor));
  } catch (err) {
    console.warn('Notification failed:', (err as Error).message);
  }
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
export async function notifyComment(db: Pool, input: { postId: number; commentId: number; actorId: number; parentId: number | null; excerpt: string }) {
  try {
    const post = await postRef(db, input.postId);
    if (!post) return;
    let repliedTo: number | null = null;
    if (input.parentId) {
      const [rows] = await db.execute<RowDataPacket[]>('SELECT user_id FROM comments WHERE id = ?', [input.parentId]);
      repliedTo = (rows[0]?.user_id as number | undefined) ?? null;
    }
    const base = { post, commentId: input.commentId, actorId: input.actorId, excerpt: input.excerpt };
    if (repliedTo) await notify(db, repliedTo, { ...base, type: 'comment_reply' });
    // The author replied to (above) already heard about it.
    if (post.authorId !== repliedTo) await notify(db, post.authorId, { ...base, type: input.parentId ? 'reply' : 'comment' });
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

/** A new support ticket: the administrators hear about it. */
export async function notifySupport(db: Pool, ticket: { id: number; title: string; email: string; userId: number | null }) {
  try {
    const [owners] = await db.execute<RowDataPacket[]>("SELECT id FROM users WHERE role = 'owner'");
    for (const owner of owners) {
      await notify(db, owner.id as number, {
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

/**
 * New posts, once they're public (published now, or a scheduled time that has come), announced once: in the app to
 * the accounts that want to hear about them (and pushed to their devices with push on), and pushed to the signed-out
 * devices that asked for them (the bell's switch). Runs every minute (index.ts).
 */
export async function announceNewPosts(db: Pool) {
  try {
    const [posts] = await db.query<RowDataPacket[]>(
      `SELECT p.id, p.author_id, p.title, p.slug, p.excerpt, ${TEXT_START} FROM posts p WHERE p.announced_at IS NULL AND ${VISIBLE_POST}`,
    );
    for (const row of posts) {
      // Claimed first, so a post is never announced twice.
      const [claimed] = await db.execute<ResultSetHeader>('UPDATE posts SET announced_at = UTC_TIMESTAMP() WHERE id = ? AND announced_at IS NULL', [row.id]);
      if (claimed.affectedRows === 0) continue;
      const post: PostRef = { id: row.id as number, authorId: row.author_id as number, title: row.title as string, slug: row.slug as string };
      const summary = summaryOf(row);
      const [readers] = await db.execute<RowDataPacket[]>("SELECT id FROM users WHERE role IN ('member', 'author') AND id <> ?", [post.authorId]);
      for (const reader of readers) {
        await notify(db, reader.id as number, { type: 'new_post', post, actorId: post.authorId, excerpt: summary });
      }
      await pushTo(db, 'new_posts = 1 AND user_id IS NULL', [], pushMessage({ type: 'new_post', post, excerpt: summary }, null));
    }
  } catch (err) {
    console.warn('Announcing new posts failed:', (err as Error).message);
  }
}
