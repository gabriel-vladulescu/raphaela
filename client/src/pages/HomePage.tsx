import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams, useSearchParams } from 'react-router';
import { BarChart3, Bookmark, FileText, Hash, Plus, Search, X } from 'lucide-react';
import { CategoryTree } from '@/components/CategoryTree';
import { NewsletterSignup } from '@/components/NewsletterSignup';
import { FeedPost, FeedPostSkeleton, PostCard, PostCardSkeleton } from '@/components/PostCard';
import { site } from '@/config';
import { useAuth } from '@/context/auth';
import { useCategories } from '@/context/categories';
import { useReactions } from '@/context/reactions';
import { trackSearch } from '@/lib/analytics';
import { api } from '@/lib/api';
import { categoryPath } from '@/lib/categories';
import { articlesPath, newArticlePath, savedPath } from '@/lib/paths';
import { useHeaderSlot } from '@/lib/headerSlot';
import { hideSplash } from '@/lib/splash';
import { useI18n } from '@/lib/i18n';
import type { PostSummary, Tag } from '@/lib/types';
import { useHideOnScroll } from '@/lib/useHideOnScroll';
import { NARROW, useMediaQuery } from '@/lib/useMediaQuery';

const PAGE_SIZE = 12;
/** The right-hand sidebar (categories, newsletter): hidden for now, the posts taking its width; true brings it back. */
const SHOW_SIDEBAR = false;

interface PostPage {
  posts: PostSummary[];
  hasMore: boolean;
}

/**
 * Narrow screens, for authors and owners: the post page's bottom bar, with their tools. New post in the round button, their
 * posts on the left, statistics on the right (the dashboard for owners, their own for authors). Out of the way
 * while scrolling down, like the post page's.
 */
function WriterBar() {
  const { user, isOwner } = useAuth();
  const { t } = useI18n();
  const hidden = useHideOnScroll();
  return (
    <nav className={`post-bar home-bar${hidden ? ' is-hidden' : ''}`} aria-label={t('home.writerBar')}>
      <div className="post-bar-bg" aria-hidden="true" />
      <div className="post-bar-inner">
        <div className="post-bar-group post-bar-left">
          <Link to={isOwner ? '/admin/articole' : articlesPath(user!.username)} className="reaction-btn reaction-btn-lg">
            <FileText size={20} />
            <span>{t('nav.manage')}</span>
          </Link>
        </div>
        <Link to={newArticlePath(user!.username)} className="post-bar-home" aria-label={t('nav.write')} title={t('nav.write')}>
          <Plus size={28} />
        </Link>
        <div className="post-bar-group post-bar-right">
          <Link to={isOwner ? '/admin/statistici' : '/statistici'} className="reaction-btn reaction-btn-lg">
            <BarChart3 size={20} />
            <span>{t('nav.stats')}</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}

/**
 * The posts, newest first (those an administrator pinned before them), with search, categories and tags
 * (/eticheta/:tag). Wide screens: a grid of cards beside the category tree.
 * Narrow screens (phones and tablets, like the post page's bottom bar): a feed (one post after another, more loading
 * on the way down), the search in the top bar, no categories.
 */
export function HomePage() {
  const { t, errorMessage } = useI18n();
  const { user, isOwner, canWrite } = useAuth();
  const { categories } = useCategories();
  const { bookmarks } = useReactions();
  const narrow = useMediaQuery(NARROW);
  const headerSlot = useHeaderSlot();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const categorySlug = params.get('category') ?? '';
  const { tag: tagSlug = '' } = useParams();
  const [tag, setTag] = useState<Tag | null>(null);

  const [search, setSearch] = useState(q);
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  /** Narrow screens: the end of the feed. When it comes near the screen, the next posts load. */
  const feedEndRef = useRef<HTMLDivElement>(null);

  // URL -> input (back/forward, chip links), without clobbering what's being typed.
  useEffect(() => {
    setSearch((current) => (current.trim() === q ? current : q));
  }, [q]);

  // Input -> URL, debounced.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim() === q) return;
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (search.trim()) next.set('q', search.trim());
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [search, q, setParams]);

  const query = (pageNumber: number) => {
    const query = new URLSearchParams({ page: String(pageNumber), limit: String(PAGE_SIZE) });
    if (q) query.set('q', q);
    if (categorySlug) query.set('category', categorySlug);
    if (tagSlug) query.set('tag', tagSlug);
    return `/posts?${query}`;
  };

  // Refetch only when the filters change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api<PostPage>(query(1))
      .then((data) => {
        if (cancelled) return;
        setPosts(data.posts);
        setHasMore(data.hasMore);
        setPage(1);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => {
        if (!cancelled) setLoading(false);
        hideSplash(); // the posts are here (or can't be): the splash can go
      });
    return () => {
      cancelled = true;
    };
  }, [q, categorySlug, tagSlug]);

  // A tag's page: its name (the address has its slug), also in the tab's title.
  useEffect(() => {
    setTag(null);
    if (!tagSlug) return;
    let cancelled = false;
    api<{ tag: Tag }>(`/tags/${encodeURIComponent(tagSlug)}`)
      .then((data) => {
        if (cancelled) return;
        setTag(data.tag);
        document.title = `#${data.tag.name} · ${site.name}`;
      })
      .catch(() => !cancelled && setTag({ name: tagSlug, slug: tagSlug }));
    return () => {
      cancelled = true;
      document.title = site.name;
    };
  }, [tagSlug]);

  // A search the reader stopped at (2 s without typing), with what it found: the admin panel's search insights.
  useEffect(() => {
    if (!q || loading || error) return;
    const timer = setTimeout(() => trackSearch(q, posts.length), 2000);
    return () => clearTimeout(timer);
  }, [q, loading]);

  async function loadMore() {
    setLoadingMore(true);
    setError('');
    try {
      const data = await api<PostPage>(query(page + 1));
      setPosts((current) => [...current, ...data.posts.filter((post) => !current.some((p) => p.id === post.id))]);
      setHasMore(data.hasMore);
      setPage(page + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  // Narrow screens: more posts as the end of the feed approaches (not after an error: the button retries).
  useEffect(() => {
    const end = feedEndRef.current;
    if (!narrow || !end || !hasMore || loading || loadingMore || error) return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && void loadMore(), {
      rootMargin: '0px 0px 900px',
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, [narrow, hasMore, loading, loadingMore, error, page]);

  const category = categories.find((c) => c.slug === categorySlug);
  const trail = category ? categoryPath(categories, category.id) : [];
  const filtered = Boolean(q || categorySlug || tagSlug);
  const [featured, ...rest] = filtered ? [undefined, ...posts] : posts;
  const withoutCategory = new URLSearchParams(params);
  withoutCategory.delete('category');
  const clearCategoryHref = `${tagSlug ? `/eticheta/${tagSlug}` : '/'}${withoutCategory.toString() ? `?${withoutCategory}` : ''}`;
  const clearTagHref = params.toString() ? `/?${params}` : '/';

  const searchBox = (
    <label className="search-box home-search">
      <Search size={18} aria-hidden="true" />
      <input
        type="search"
        value={search}
        placeholder={t('home.search')}
        aria-label={t('home.search')}
        onChange={(event) => setSearch(event.target.value)}
      />
      {search && (
        <button type="button" className="icon-btn icon-btn-sm" aria-label={t('home.clearFilters')} onClick={() => setSearch('')}>
          <X size={16} />
        </button>
      )}
    </label>
  );

  return (
    <div className={`container home-layout${SHOW_SIDEBAR ? '' : ' is-full'}${isOwner ? ' no-saved' : ''}`}>
      {/* Narrow screens: in the top bar, beside its buttons. */}
      {narrow && headerSlot ? createPortal(searchBox, headerSlot) : searchBox}

      {/* Administrators don't save posts. */}
      {!isOwner && (
        <Link to={savedPath(user?.username)} className="saved-pill">
          <Bookmark size={18} />
          <span>{t('nav.saved')}</span>
          {bookmarks.length > 0 && <span className="saved-pill-count">{bookmarks.length}</span>}
        </Link>
      )}

      {SHOW_SIDEBAR && (
        <aside className="sidebar">
          <div className="card">
            <CategoryTree />
          </div>
          {!narrow && <NewsletterSignup />}
        </aside>
      )}

      <section className="feed" aria-busy={loading}>
        {(category || q || tagSlug) && (
          <div className="feed-context">
            {tagSlug && (
              <span className="filter-chip">
                <span className="filter-chip-current">
                  <Hash size={14} aria-hidden="true" />
                  {tag?.name ?? tagSlug}
                </span>
                <Link to={clearTagHref} className="filter-chip-clear" aria-label={t('home.clearFilters')} title={t('home.clearFilters')}>
                  <X size={14} />
                </Link>
              </span>
            )}
            {category && (
              <span className="filter-chip">
                {trail.map((c, i) => (
                  <span key={c.id} className={i === trail.length - 1 ? 'filter-chip-current' : 'muted'}>
                    {i === trail.length - 1 && c.icon && <span aria-hidden="true">{c.icon} </span>}
                    {c.name}
                  </span>
                ))}
                <Link
                  to={clearCategoryHref}
                  className="filter-chip-clear"
                  aria-label={t('home.clearFilters')}
                  title={t('home.clearFilters')}
                >
                  <X size={14} />
                </Link>
              </span>
            )}
            {q && <span className="results-label">{t('home.resultsFor', { q })}</span>}
          </div>
        )}
        {category?.description && <p className="feed-description muted">{category.description}</p>}
        {error && <p className="form-error">{error}</p>}

        {loading ? (
          narrow ? (
            <div className="feed-list">
              {Array.from({ length: 3 }, (_, index) => (
                <FeedPostSkeleton key={index} />
              ))}
            </div>
          ) : (
            <div className="post-grid">
              {Array.from({ length: 6 }, (_, index) => (
                <PostCardSkeleton key={index} />
              ))}
            </div>
          )
        ) : posts.length === 0 ? (
          <div className="empty-state card">
            <span className="empty-glyph" aria-hidden="true">✧</span>
            <p>{filtered ? t('home.emptySearch') : t('home.empty')}</p>
            {filtered && (
              <Link to="/" className="btn btn-secondary">
                {t('home.clearFilters')}
              </Link>
            )}
          </div>
        ) : narrow ? (
          <>
            <div className="feed-list">
              {posts.map((post, index) => (
                <Fragment key={post.id}>
                  <FeedPost post={post} featured={post === featured} />
                  {/* The newsletter, a few posts in (wide screens have it in the sidebar). */}
                  {index === Math.min(3, posts.length - 1) && !filtered && <NewsletterSignup variant="wide" />}
                </Fragment>
              ))}
              {loadingMore && <FeedPostSkeleton />}
            </div>
            {hasMore && <div ref={feedEndRef} className="feed-end" aria-hidden="true" />}
            {hasMore && error && !loadingMore && (
              <div className="load-more">
                <button type="button" className="btn btn-secondary" onClick={loadMore}>
                  {t('home.loadMore')}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {featured && <PostCard post={featured} featured />}
            <div className="post-grid">{rest.map((post) => post && <PostCard key={post.id} post={post} />)}</div>
            {hasMore && (
              <div className="load-more">
                <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? t('common.loading') : t('home.loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {narrow && canWrite && <WriterBar />}
    </div>
  );
}
