import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Archive, AtSign, Check, CheckCheck, Clock, Eye, Flag, Heart, LifeBuoy, MessageCircle, Reply, Share2, SlidersHorizontal, SmilePlus, Sparkles, Trophy, UserX } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { PageBand } from '@/components/PageBand';
import { KINDS, NO_FILTER, NotificationFilters } from '@/components/NotificationFilters';
import type { NotificationFilter, NotificationKind } from '@/components/NotificationFilters';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { setUnread } from '@/lib/unread';

interface Notification {
  id: number;
  type:
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
    | 'followed_post'
    | 'cleanup_due'
    | 'support_reply';
  /** Likes and shares grouped while unread. */
  times: number;
  /** Shares: the app. */
  detail: string | null;
  /** Views: the count; milestones: the threshold; old data: how many rows. Details: shares, the app; reactions, the
   *  emoji; milestones, comments, likes or views. */
  value: number | null;
  createdAt: string;
  read: boolean;
  post: { id: number; title: string; slug: string } | null;
  comment: { id: number; body: string | null } | null;
  actor: { id: number; name: string; picture: string | null } | null;
  ticket: { id: number; title: string; email: string } | null;
  /** Administrators: a deleted account waiting to be deleted for good. */
  account: { id: number; name: string } | null;
}

interface Page {
  notifications: Notification[];
  next: string | null;
  unread: number;
  post: { id: number; title: string } | null;
}

const ICONS: Record<Notification['type'], LucideIcon> = {
  comment: MessageCircle,
  reply: MessageCircle,
  like: Heart,
  share: Share2,
  views: Eye,
  new_post: Sparkles,
  comment_reply: Reply,
  comment_reaction: SmilePlus,
  post_reaction: SmilePlus,
  milestone: Trophy,
  support: LifeBuoy,
  report: Flag,
  account_due: UserX,
  cleanup_due: Archive,
  support_reply: LifeBuoy,
  comment_held: Clock,
  mention: AtSign,
  followed_post: Sparkles,
};
/** Each kind's name under its text: one per kind (a new kind without a name doesn't compile). */
const KIND_NAMES: Record<Notification['type'], MessageKey> = {
  comment: 'notif.kindOne.comment',
  reply: 'notif.kindOne.reply',
  like: 'notif.kindOne.like',
  share: 'notif.kindOne.share',
  views: 'notif.kindOne.views',
  new_post: 'notif.kindOne.new_post',
  comment_reply: 'notif.kindOne.comment_reply',
  comment_reaction: 'notif.kindOne.comment_reaction',
  post_reaction: 'notif.kindOne.post_reaction',
  milestone: 'notif.kindOne.milestone',
  support: 'notif.kindOne.support',
  report: 'notif.kindOne.report',
  account_due: 'notif.kindOne.account_due',
  cleanup_due: 'notif.kindOne.cleanup_due',
  support_reply: 'notif.kindOne.support_reply',
  comment_held: 'notif.kindOne.comment_held',
  mention: 'notif.kindOne.mention',
  followed_post: 'notif.kindOne.followed_post',
};
const APPS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
  telegram: 'Telegram',
  pinterest: 'Pinterest',
  email: 'email',
};

/** A translated sentence with the post's title in bold where it says {post}. */
function sentence(text: string, post: ReactNode) {
  return text.split(/(\{post\})/).map((part, i) => (part === '{post}' ? <span key={i}>{post}</span> : part));
}

/** The filter, as the page's address keeps it (so going back to the page finds it as it was). */
function readFilter(params: URLSearchParams, postTitle: string | null): NotificationFilter {
  const date = (key: string) => {
    const value = params.get(key);
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  };
  const kind = params.get('type') as NotificationKind | null;
  const post = Number(params.get('post')) || null;
  return {
    kind: kind && KINDS.includes(kind) ? kind : null,
    unread: params.get('unread') === '1',
    post: post ? { id: post, title: postTitle } : null,
    from: date('from'),
    to: date('to'),
  };
}

function writeFilter(filter: NotificationFilter) {
  const params = new URLSearchParams();
  if (filter.kind) params.set('type', filter.kind);
  if (filter.unread) params.set('unread', '1');
  if (filter.post) params.set('post', String(filter.post.id));
  if (filter.from) params.set('from', filter.from.toISOString());
  if (filter.to) params.set('to', filter.to.toISOString());
  return params;
}

/** The API's query for a page of the filtered list. */
function listQuery(filter: NotificationFilter, before: string | null) {
  const params = writeFilter(filter);
  if (params.has('unread')) params.set('unread', 'true');
  params.set('limit', '20');
  if (before) params.set('before', before);
  return `/notifications?${params}`;
}

/**
 * An account's notifications (what it chose to hear about, Settings): newest first, grouped by day, loading more on
 * the way down. Filters: unread, kind (what the role can get), post, period. Nothing is marked read just by opening
 * the page: that's the buttons, or opening a notification.
 */
export function NotificationsPage() {
  const { t, plural, formatDate, formatNumber, timeAgo } = useI18n();
  const { user } = useAuth();
  const role = user?.role ?? 'member';
  const [params, setParams] = useSearchParams();
  const [postTitle, setPostTitle] = useState<string | null>(null);
  const filter = readFilter(params, postTitle);
  const filterKey = writeFilter(filter).toString();

  const [items, setItems] = useState<Notification[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [unread, setUnreadTotal] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  /** The filter the list on screen is for: pages for an earlier one are dropped. */
  const shown = useRef(filterKey);

  const took = (data: Page) => {
    setNext(data.next);
    setUnreadTotal(data.unread);
    setUnread(data.unread); // the bell
    if (data.post) setPostTitle(data.post.title);
  };

  // The first page, again whenever the filter changes.
  useEffect(() => {
    let cancelled = false;
    shown.current = filterKey;
    setStatus('loading');
    setItems([]);
    setNext(null);
    setMoreFailed(false);
    api<Page>(listQuery(filter, null))
      .then((data) => {
        if (cancelled) return;
        setItems(data.notifications);
        took(data);
        setStatus('ready');
      })
      .catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
    };
  }, [filterKey]);

  async function loadMore() {
    const key = filterKey;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const data = await api<Page>(listQuery(filter, next));
      if (shown.current !== key) return;
      setItems((list) => [...list, ...data.notifications.filter((n) => !list.some((m) => m.id === n.id))]);
      took(data);
    } catch {
      if (shown.current === key) setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }

  // More as the end of the list comes near.
  useEffect(() => {
    const end = endRef.current;
    if (!end || !next || loadingMore || moreFailed || status !== 'ready') return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && void loadMore(), {
      rootMargin: '0px 0px 600px',
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, [next, loadingMore, moreFailed, status, filterKey]);

  const changeFilter = (change: NotificationFilter) => {
    if (change.post) setPostTitle(change.post.title);
    setParams(writeFilter(change), { replace: true });
  };

  /** Marks these as read (all of them without ids); the bell follows. */
  function markRead(ids?: number[]) {
    setItems((list) => list.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    api<{ unread: number }>('/notifications/read', { method: 'POST', body: ids ? { ids } : {} })
      .then((result) => {
        setUnreadTotal(result.unread);
        setUnread(result.unread);
      })
      .catch(() => undefined);
  }

  const describe = (n: Notification) => {
    const who = n.actor?.name ?? t('notif.someone');
    const post = <strong className="notif-post">„{n.post?.title ?? t('notif.deletedPost')}”</strong>;
    const say = (key: MessageKey, vars: Record<string, string | number> = {}) => sentence(t(key, { name: who, ...vars }), post);
    switch (n.type) {
      case 'comment':
        return say('notif.comment');
      case 'reply':
        return say('notif.reply');
      case 'like':
        if (n.times === 1) return say('notif.like');
        return n.actor ? say('notif.likeMany', { n: n.times - 1 }) : say('notif.likeManyGuests', { n: n.times });
      case 'share': {
        const app = n.detail && APPS[n.detail] ? ` ${t('notif.shareApp', { app: APPS[n.detail]! })}` : '';
        return n.times === 1 ? [...say('notif.share'), app] : say('notif.shareMany', { n: n.times });
      }
      case 'views':
        return say('notif.views', { views: plural('post.views', n.value ?? 0) });
      case 'new_post':
        return say('notif.newPost');
      case 'comment_reply':
        return say('notif.commentReply');
      case 'comment_reaction':
        return n.times === 1 ? say('notif.commentReaction', { emoji: n.detail ?? '' }) : say('notif.commentReactionMany', { n: n.times - 1 });
      case 'post_reaction':
        return n.times === 1 ? say('notif.postReaction', { emoji: n.detail ?? '' }) : say('notif.postReactionMany', { n: n.times - 1 });
      case 'milestone': {
        const metric = (n.detail ?? 'views') as 'comments' | 'likes' | 'views';
        if ((n.value ?? 0) === 1) return say(`notif.milestone.${metric}.first` as MessageKey);
        const total = n.value ?? 0;
        const count = metric === 'comments' ? plural('notif.comments', total) : metric === 'likes' ? plural('notif.likes', total) : plural('post.views', total);
        return say('notif.milestone.reached', { count });
      }
      case 'support':
        return t(n.detail === 'reply' ? 'notif.supportAnswer' : 'notif.support', { email: n.ticket?.email ?? '', title: n.ticket?.title ?? '' });
      case 'support_reply':
        return t('notif.supportReply', { title: n.ticket?.title ?? '' });
      case 'report':
        return n.times === 1 ? say('notif.report') : say('notif.reportMany', { n: n.times });
      case 'account_due':
        return t('notif.accountDue', { name: n.account?.name ?? '' });
      case 'cleanup_due':
        return t('notif.cleanupDue', { n: formatNumber(n.value ?? 0) });
      case 'comment_held':
        return n.times === 1 ? say('notif.held') : say('notif.heldMany', { n: n.times });
      case 'mention':
        return say('notif.mention');
      case 'followed_post':
        return say('notif.followedPost');
    }
  };

  /** Where a notification leads: its ticket, its post's discussion, or the post. */
  const target = (n: Notification) => {
    if (n.type === 'support') return n.ticket ? `/admin/suport/${n.ticket.id}` : '/admin/suport';
    if (n.type === 'report') return '/admin/comentarii?filter=reported';
    if (n.type === 'comment_held') return '/admin/comentarii?filter=held';
    if (n.type === 'account_due') return n.account ? `/admin/utilizatori?status=due&id=${n.account.id}` : '/admin/utilizatori?status=due';
    if (n.type === 'cleanup_due') return '/admin/jurnal?tab=cleanup';
    if (n.type === 'support_reply') return n.ticket ? `/suport/tichete/${n.ticket.id}` : '/suport/tichete';
    if (!n.post) return '/';
    const discussion = ['comment', 'reply', 'comment_reply', 'comment_reaction', 'post_reaction', 'mention'].includes(n.type);
    return `/posts/${n.post.slug}${discussion ? '#discussion-title' : ''}`;
  };

  // By day: "Azi", "Ieri", then the date.
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const dayTitle = (date: Date) =>
    date.toDateString() === today.toDateString()
      ? t('date.today')
      : date.toDateString() === yesterday.toDateString()
        ? t('date.yesterday')
        : formatDate(date);
  const days: { key: string; title: string; items: Notification[] }[] = [];
  for (const n of items) {
    const date = new Date(n.createdAt);
    const key = date.toDateString();
    if (days[days.length - 1]?.key !== key) days.push({ key, title: dayTitle(date), items: [] });
    days[days.length - 1]!.items.push(n);
  }
  const filtered = filterKey !== '';

  return (
    <div className="container notif-page">
      <HeaderBackLink />
      {/* All or unread as its tabs; the type, the post and the period on the band under them. */}
      <PageBand
        title={t('notif.title')}
        line={t(role === 'owner' ? 'notif.subtitleAdmin' : role === 'author' ? 'notif.subtitle' : 'notif.subtitleMember')}
        actions={
          <>
            {/* What to be notified of, and push on this device: the Settings page. */}
            <Link to="/setari" className="btn btn-soft btn-sm notif-settings-link">
              <SlidersHorizontal size={16} aria-hidden="true" /> {t('notif.settingsLink')}
            </Link>
            {unread > 0 && (
              <button type="button" className="btn btn-soft btn-sm" onClick={() => markRead()}>
                <CheckCheck size={16} /> {t('notif.markAllRead')}
              </button>
            )}
          </>
        }
        tabsLabel={t('notif.filters')}
        tabs={[
          { key: 'all', label: t('notif.kind.all'), active: !filter.unread, onClick: () => changeFilter({ ...filter, unread: false }) },
          { key: 'unread', label: t('notif.unreadOnly'), count: unread > 0 ? Math.min(unread, 99) : undefined, active: filter.unread, onClick: () => changeFilter({ ...filter, unread: true }) },
        ]}
        tools={<NotificationFilters filter={filter} unread={unread} role={role} onChange={changeFilter} tabs={false} />}
      />

      <section className="notif-main" aria-busy={status === 'loading'}>

        {status === 'loading' ? (
          <ul className="notif-list card" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="notif-item notif-skeleton">
                <span className="skeleton notif-skeleton-avatar" />
                <span className="notif-body">
                  <span className="skeleton skeleton-line" style={{ width: '80%' }} />
                  <span className="skeleton skeleton-line" style={{ width: '35%' }} />
                </span>
              </li>
            ))}
          </ul>
        ) : status === 'error' ? (
          <p className="form-error">{t('error.generic')}</p>
        ) : items.length === 0 ? (
          <div className="empty-state card">
            <span className="empty-glyph" aria-hidden="true">
              ✦
            </span>
            <p>{t(filtered ? 'notif.emptyFiltered' : 'notif.empty')}</p>
            {filtered && (
              <button type="button" className="btn btn-secondary" onClick={() => changeFilter(NO_FILTER)}>
                {t('notif.reset')}
              </button>
            )}
          </div>
        ) : (
          <>
            {days.map((day) => (
              <section key={day.key} className="notif-group" aria-label={day.title}>
                <h2 className="notif-day">{day.title}</h2>
                <ul className="notif-list card">
                  {day.items.map((n) => {
                    const Icon = ICONS[n.type];
                    const to = target(n);
                    return (
                      <li key={n.id} className={`notif-item${n.read ? '' : ' is-unread'}`}>
                        <Link to={to} className="notif-link" onClick={() => !n.read && markRead([n.id])}>
                          <span className="notif-avatar">
                            {/* Support answers come from the site: its logo (as in the header), not the administrator's face. */}
                            {n.type === 'support_reply' ? (
                              <img className="notif-site-logo" src="/icons/logo-480.webp" alt="" width={44} height={44} />
                            ) : n.actor ? (
                              <Avatar name={n.actor.name} picture={n.actor.picture} size={44} />
                            ) : (
                              <span className={`notif-glyph notif-glyph-${n.type}`}>
                                <Icon size={20} />
                              </span>
                            )}
                            <span className={`notif-type notif-type-${n.type}`} aria-hidden="true">
                              <Icon size={11} strokeWidth={2.6} />
                            </span>
                          </span>
                          <span className="notif-body">
                            <span className="notif-text">{describe(n)}</span>
                            {n.comment && <span className="notif-excerpt">{n.comment.body ?? t('notif.commentDeleted')}</span>}
                            <span className="notif-meta">
                              <span className={`notif-kind notif-kind-${n.type}`}>{t(KIND_NAMES[n.type])}</span>
                              <span aria-hidden="true">·</span>
                              <time dateTime={n.createdAt}>{timeAgo(n.createdAt)}</time>
                              {!n.read && <span className="visually-hidden">{t('notif.unreadLabel')}</span>}
                            </span>
                          </span>
                        </Link>
                        {!n.read && (
                          <button type="button" className="icon-btn notif-read" aria-label={t('notif.markRead')} title={t('notif.markRead')} onClick={() => markRead([n.id])}>
                            <Check size={18} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {next && <div ref={endRef} className="notif-end" aria-hidden="true" />}
            {loadingMore && <p className="muted small notif-more-status">{t('common.loading')}</p>}
            {moreFailed && (
              <button type="button" className="btn btn-secondary notif-more-status" onClick={() => void loadMore()}>
                {t('notif.retry')}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
