import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AtSign, Bell, Check, ChevronDown, Clock, Eye, Flag, Heart, LifeBuoy, MessageCircle, Reply, Search, Share2, SmilePlus, Sparkles, Trophy, UserX, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DateRangePicker } from '@/components/DateRangePicker';
import { MenuButton } from '@/components/MenuButton';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { NARROW, useMediaQuery } from '@/lib/useMediaQuery';

export type NotificationKind =
  | 'new_posts'
  | 'replies_to_me'
  | 'reactions_to_me'
  | 'mentions'
  | 'comments'
  | 'reactions'
  | 'likes'
  | 'shares'
  | 'views'
  | 'milestones'
  | 'support'
  | 'reports'
  | 'accounts'
  | 'held';
export const KINDS: NotificationKind[] = [
  'new_posts',
  'replies_to_me',
  'reactions_to_me',
  'mentions',
  'comments',
  'reactions',
  'likes',
  'shares',
  'views',
  'milestones',
  'support',
  'reports',
  'accounts',
  'held',
];

/** What an account can get, by role (lib/notifications.ts on the server): members hear about new posts, their own
 *  comments and being mentioned, authors also about their posts, administrators only about support, reports,
 *  comments waiting for approval and accounts to delete. */
export function kindsFor(role: 'member' | 'author' | 'owner'): NotificationKind[] {
  if (role === 'owner') return ['support', 'reports', 'held', 'accounts'];
  const forEveryone: NotificationKind[] = ['new_posts', 'replies_to_me', 'reactions_to_me', 'mentions'];
  return role === 'author' ? [...forEveryone, 'comments', 'reactions', 'likes', 'shares', 'views', 'milestones'] : forEveryone;
}

export interface NotificationFilter {
  kind: NotificationKind | null;
  unread: boolean;
  /** The title is null until it's known (a filter opened from the address). */
  post: { id: number; title: string | null } | null;
  from: Date | null;
  to: Date | null;
}

export const NO_FILTER: NotificationFilter = { kind: null, unread: false, post: null, from: null, to: null };

const KIND_ICONS: Record<NotificationKind, LucideIcon> = {
  new_posts: Sparkles,
  replies_to_me: Reply,
  reactions_to_me: SmilePlus,
  mentions: AtSign,
  comments: MessageCircle,
  reactions: SmilePlus,
  likes: Heart,
  shares: Share2,
  views: Eye,
  milestones: Trophy,
  support: LifeBuoy,
  reports: Flag,
  accounts: UserX,
  held: Clock,
};

/** A filter, as a field: its name and current value, opening a menu (MenuButton: a panel, a dialog or a sheet). */
function FilterMenu(props: { title: string; value: ReactNode; active: boolean; children: (close: () => void) => ReactNode }) {
  const { title, value, active, children } = props;
  return (
    <MenuButton
      title={title}
      buttonClassName={`filter-field${active ? ' has-value' : ''}`}
      panelClassName="filter-popover"
      button={
        <>
          <span className="filter-field-text">
            <span className="filter-field-label">{title}</span>
            <span className="filter-field-value">{value}</span>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </>
      }
    >
      {children}
    </MenuButton>
  );
}

interface ArticleOption {
  id: number;
  title: string;
  total: number;
  unread: number;
}

/**
 * The posts the notifications are about, latest activity first: searchable, and loaded 20 at a time as the list
 * scrolls (GET /notifications/posts).
 */
function ArticlePicker({ value, onPick }: { value: number | null; onPick: (post: { id: number; title: string } | null) => void }) {
  const { t } = useI18n();
  // Not on touch screens, where it would bring up the keyboard over the list.
  const narrow = useMediaQuery(NARROW);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [posts, setPosts] = useState<ArticleOption[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  /** The search the list on screen is for: answers to an older one are dropped. */
  const current = useRef('');

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [text]);

  // A new search starts the list over.
  useEffect(() => {
    current.current = query;
    setPosts([]);
    setHasMore(true);
    setFailed(false);
  }, [query]);

  async function loadMore() {
    const search = query;
    setLoading(true);
    try {
      const params = new URLSearchParams({ offset: String(posts.length), limit: '20' });
      if (search) params.set('q', search);
      const data = await api<{ posts: ArticleOption[]; hasMore: boolean }>(`/notifications/posts?${params}`);
      if (current.current !== search) return;
      setPosts((list) => [...list, ...data.posts.filter((post) => !list.some((p) => p.id === post.id))]);
      setHasMore(data.hasMore);
    } catch {
      if (current.current === search) setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  // More as the end of the list comes into view (inside the list's own scroll).
  useEffect(() => {
    const end = endRef.current;
    if (!end || !hasMore || loading || failed) return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && void loadMore(), {
      root: listRef.current,
      rootMargin: '0px 0px 120px',
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, [hasMore, loading, failed, posts.length, query]);

  return (
    <div className="article-picker">
      <label className="search-box article-search">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={text}
          placeholder={t('notif.searchArticles')}
          aria-label={t('notif.searchArticles')}
          autoFocus={!narrow}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div ref={listRef} className="article-list" role="listbox" aria-label={t('notif.article')}>
        {!query && (
          <button type="button" role="option" aria-selected={value === null} className={`filter-option${value === null ? ' is-selected' : ''}`} onClick={() => onPick(null)}>
            <span className="article-option-title">{t('notif.allArticles')}</span>
            {value === null && <Check size={16} className="filter-option-check" />}
          </button>
        )}
        {posts.map((post) => (
          <button
            key={post.id}
            type="button"
            role="option"
            aria-selected={value === post.id}
            className={`filter-option${value === post.id ? ' is-selected' : ''}`}
            onClick={() => onPick({ id: post.id, title: post.title })}
          >
            <span className="article-option-title">{post.title}</span>
            {/* Just the unread ones, as a badge (the total is in its tooltip). */}
            {post.unread > 0 && (
              <span className="article-option-count" title={t('notif.countTitle', { total: post.total, unread: post.unread })}>
                <span className="article-option-unread">{post.unread}</span>
              </span>
            )}
            {value === post.id && <Check size={16} className="filter-option-check" />}
          </button>
        ))}
        {loading && <p className="muted small article-status">{t('common.loading')}</p>}
        {failed && (
          <button type="button" className="btn btn-ghost btn-sm article-status" onClick={() => setFailed(false)}>
            {t('notif.retry')}
          </button>
        )}
        {!loading && !failed && !hasMore && posts.length === 0 && <p className="muted small article-status">{t('notif.noArticles')}</p>}
        <div ref={endRef} className="article-end" aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * The notifications page's filters, in one row (two by two on phones): all or unread (with the unread count; not with
 * `tabs` false, when the page shows them as its own tabs), the type (what the role can get), the post (not for
 * administrators: theirs are about support) and the period.
 */
export function NotificationFilters(props: {
  filter: NotificationFilter;
  unread: number;
  role: 'member' | 'author' | 'owner';
  onChange: (filter: NotificationFilter) => void;
  tabs?: boolean;
}) {
  const { filter, unread, role, onChange, tabs = true } = props;
  const { t, locale } = useI18n();
  const set = (change: Partial<NotificationFilter>) => onChange({ ...filter, ...change });
  const kinds = kindsFor(role);
  const filtered = filter.kind !== null || filter.post !== null || filter.from !== null || filter.to !== null;

  let period: string | null = null;
  if (filter.from || filter.to) {
    const from = filter.from ?? filter.to!;
    const to = filter.to ?? filter.from!;
    // Times only when they're not whole days.
    const wholeDays = from.getHours() === 0 && from.getMinutes() === 0 && to.getHours() === 23 && to.getMinutes() === 59;
    const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(wholeDays ? {} : { hour: '2-digit', minute: '2-digit' }) });
    period = wholeDays && from.toDateString() === to.toDateString() ? format.format(from) : `${format.format(from)} – ${format.format(to)}`;
  }

  const option = (key: string, selected: boolean, label: ReactNode, onPick: () => void, Icon?: LucideIcon) => (
    <button key={key} type="button" role="option" aria-selected={selected} className={`filter-option${selected ? ' is-selected' : ''}`} onClick={onPick}>
      {Icon && <Icon size={18} aria-hidden="true" />}
      {label}
      {selected && <Check size={16} className="filter-option-check" />}
    </button>
  );

  return (
    <div className={`notif-filters${tabs ? '' : ' no-tabs'}`} role="group" aria-label={t('notif.filters')}>
      {tabs && (
      <div className="segmented notif-tabs">
        <button type="button" className={filter.unread ? '' : 'is-selected'} aria-pressed={!filter.unread} onClick={() => set({ unread: false })}>
          {t('notif.kind.all')}
        </button>
        <button type="button" className={filter.unread ? 'is-selected' : ''} aria-pressed={filter.unread} onClick={() => set({ unread: true })}>
          {t('notif.unreadOnly')}
          {unread > 0 && <span className="filter-count">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </div>
      )}
      {kinds.length > 1 && (
        <FilterMenu title={t('notif.kind')} active={filter.kind !== null} value={filter.kind ? t(`notif.kind.${filter.kind}` as MessageKey) : t('notif.kind.all')}>
          {(close) => (
            <div className="filter-options" role="listbox" aria-label={t('notif.kind')}>
              {option('all', filter.kind === null, t('notif.kind.all'), () => (set({ kind: null }), close()), Bell)}
              {kinds.map((kind) => option(kind, filter.kind === kind, t(`notif.kind.${kind}` as MessageKey), () => (set({ kind }), close()), KIND_ICONS[kind]))}
            </div>
          )}
        </FilterMenu>
      )}

      {role !== 'owner' && (
        <FilterMenu title={t('notif.article')} active={filter.post !== null} value={filter.post ? (filter.post.title ?? '…') : t('notif.allArticles')}>
          {(close) => (
            <ArticlePicker
              value={filter.post?.id ?? null}
              onPick={(post) => {
                set({ post });
                close();
              }}
            />
          )}
        </FilterMenu>
      )}

      <FilterMenu title={t('notif.period')} active={period !== null} value={period ?? t('notif.anytime')}>
        {(close) => <DateRangePicker value={{ from: filter.from, to: filter.to }} onChange={(range) => set(range)} onDone={close} anytime={t('notif.anytime')} />}
      </FilterMenu>

      {filtered && (
        <button type="button" className="btn btn-ghost btn-sm filter-reset" onClick={() => onChange({ ...NO_FILTER, unread: filter.unread })}>
          <X size={15} /> {t('notif.reset')}
        </button>
      )}
    </div>
  );
}
