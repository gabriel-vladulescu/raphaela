import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, CalendarClock, CalendarDays, Clock, Eye, Heart, House, MessageCircle, SquarePen } from 'lucide-react';
import { AuthorSignature } from '@/components/AuthorSignature';
import { Comments } from '@/components/Comments';
import { FollowButton } from '@/components/FollowButton';
import { NewsletterSignup } from '@/components/NewsletterSignup';
import { BookmarkButton, LikeButton } from '@/components/ReactionButtons';
import { ShareButton } from '@/components/ShareSheet';
import { site } from '@/config';
import { useAuth } from '@/context/auth';
import { useCategories } from '@/context/categories';
import { useReactions } from '@/context/reactions';
import { setReadProgress, track, trackPage } from '@/lib/analytics';
import { api, ApiError } from '@/lib/api';
import { categoryPath } from '@/lib/categories';
import { articlePath } from '@/lib/paths';
import { useHeaderSlot } from '@/lib/headerSlot';
import { useI18n } from '@/lib/i18n';
import { initialPost } from '@/lib/pageData';
import type { Post, PostSummary } from '@/lib/types';
import { NARROW, useMediaQuery } from '@/lib/useMediaQuery';

interface TocEntry {
  id: string;
  text: string;
  level: number;
}

const anchorId = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sectiune';

export function PostPage() {
  const { slug = '' } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { user, isOwner, canEditPost } = useAuth();
  const { categories } = useCategories();
  const { t, plural, formatDate, formatShortDate, formatDateTime } = useI18n();
  const { isLiked, toggleLike } = useReactions();
  const [post, setPost] = useState<Post | null>(() => initialPost(slug));
  const [notFound, setNotFound] = useState(false);
  /** Couldn't be loaded (offline, server down), with nothing to show from the page itself. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [commentCount, setCommentCount] = useState(() => initialPost(slug)?.commentCount ?? 0);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [related, setRelated] = useState<PostSummary[]>([]);
  const [views, setViews] = useState<number | null>(null);
  /** The end of the text is on screen: the bar offers the next article. */
  const [atEnd, setAtEnd] = useState(false);
  /** The bar steps aside while scrolling down, and comes back on the way up. */
  const [barHidden, setBarHidden] = useState(false);
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const lastTap = useRef({ time: 0, x: 0, y: 0 });
  const narrow = useMediaQuery(NARROW);
  const headerSlot = useHeaderSlot();

  // Refetched when the viewer changes: authors may open their own drafts, owners anything.
  useEffect(() => {
    let cancelled = false;
    setNotFound(false);
    setLoadFailed(false);
    api<{ post: Post }>(`/posts/${encodeURIComponent(slug)}`)
      .then((data) => {
        if (cancelled) return;
        setPost(data.post);
        setCommentCount(data.post.commentCount);
      })
      .catch((err) => {
        if (cancelled) return;
        // The post's address changed (its title did): on to the new one, in place of the old in the history.
        if (err instanceof ApiError && err.code === 'moved' && typeof err.data.slug === 'string') {
          navigate(`/posts/${encodeURIComponent(err.data.slug)}${hash}`, { replace: true });
          return;
        }
        // Only a 404 means there's no such post. Otherwise (e.g. offline, reading a page saved by the installed
        // app) the post the page came with stays.
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, user?.id, user?.role]);

  useEffect(() => {
    document.title = post ? `${post.title} · ${site.name}` : site.name;
    return () => {
      document.title = site.name;
    };
  }, [post]);

  // The view counts once the post is known (one per visitor and day); the reply has the updated count.
  const postId = post?.slug === slug ? post.id : null;
  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    void trackPage(window.location.pathname, postId).then((count) => !cancelled && count !== null && setViews(count));
    return () => {
      cancelled = true;
    };
  }, [postId]);

  // On scroll: how much of the text has been on screen (the ring around the middle button, and the statistics),
  // whether its end is in view, and the bar hiding on the way down (back on the way up, near the top, and at the end).
  useEffect(() => {
    if (!postId) return;
    let lastY = window.scrollY;
    let wasAtEnd = false;
    let frame = 0;
    const update = () => {
      frame = 0;
      const content = contentRef.current;
      if (!content) return;
      const box = content.getBoundingClientRect();
      // What the bar covers isn't on screen (it has no height where it's hidden, on wide screens).
      const visibleBottom = window.innerHeight - (barRef.current?.offsetHeight ?? 0);
      const progress = Math.min(1, Math.max(0, (visibleBottom - box.top) / Math.max(1, box.height)));
      barRef.current?.style.setProperty('--progress', progress.toFixed(4));
      setReadProgress(progress * 100);
      const end = progress >= 1;
      setAtEnd(end);
      const y = window.scrollY;
      if (y < 120 || y < lastY - 6 || (end && !wasAtEnd)) setBarHidden(false);
      else if (y > lastY + 6) setBarHidden(true);
      lastY = y;
      wasAtEnd = end;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [postId]);

  // Give the article's headings ids, and list them in the sidebar.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const used = new Set<string>();
    const entries: TocEntry[] = [];
    root.querySelectorAll('h2, h3').forEach((heading) => {
      const text = heading.textContent?.trim() ?? '';
      let id = anchorId(text);
      for (let n = 2; used.has(id); n++) id = `${anchorId(text)}-${n}`;
      used.add(id);
      heading.id = id;
      entries.push({ id, text, level: Number(heading.tagName[1]) });
    });
    setToc(entries);
  }, [post?.contentHtml]);

  // Arriving at a section (#discussion-title from the feed or a notification, a heading's link): it exists only
  // once the post has loaded, after the router's own scroll. What loads above it next ("Read next", pictures) would
  // push it down, so it's held in view for a few seconds, until the reader scrolls on their own.
  useEffect(() => {
    if (!postId || !hash) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    const hold = () => target.scrollIntoView();
    hold();
    const observer = new ResizeObserver(hold);
    observer.observe(document.body);
    const release = () => {
      observer.disconnect();
      clearTimeout(timer);
      for (const type of ['wheel', 'touchstart', 'keydown'] as const) window.removeEventListener(type, release);
    };
    const timer = setTimeout(release, 3000);
    for (const type of ['wheel', 'touchstart', 'keydown'] as const) window.addEventListener(type, release, { passive: true });
    return release;
  }, [postId, hash]);

  // "Read next": the same category first, topped up with the latest posts.
  useEffect(() => {
    if (!post) return;
    let cancelled = false;
    const others = (list: PostSummary[]) => list.filter((p) => p.id !== post.id);
    (async () => {
      let list = post.category ? others((await api<{ posts: PostSummary[] }>(`/posts?limit=4&category=${post.category.slug}`)).posts) : [];
      if (list.length < 3) {
        const latest = others((await api<{ posts: PostSummary[] }>('/posts?limit=6')).posts);
        list = [...list, ...latest.filter((p) => !list.some((x) => x.id === p.id))];
      }
      if (!cancelled) setRelated(list.slice(0, 3));
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [post]);

  // Narrow screens (with the bottom bar): "Back to posts" sits in the top bar, left of its buttons, which saves a
  // line above the banner. Wide screens have it on that line, with Edit at its other end.
  const backInBar =
    narrow && headerSlot
      ? createPortal(
          <Link to="/" className="back-link">
            <ArrowLeft size={16} /> {t('post.backHome')}
          </Link>,
          headerSlot,
        )
      : null;

  if (notFound || (loadFailed && (!post || post.slug !== slug))) {
    return (
      <div className="container">
        <div className="empty-state card">
          <span className="empty-glyph" aria-hidden="true">☾</span>
          <p>{t(notFound ? 'post.notFound' : 'post.loadFailed')}</p>
          <Link to="/" className="btn btn-secondary">
            {t('post.backHome')}
          </Link>
        </div>
      </div>
    );
  }

  if (!post || post.slug !== slug) {
    return (
      <div className="container post-skeleton" aria-busy="true">
        {backInBar ?? <div className="skeleton skeleton-line" style={{ width: '20%' }} />}
        <div className="skeleton skeleton-banner" />
      </div>
    );
  }

  const trail = post.category ? categoryPath(categories, post.category.id) : [];
  // Only the post's author (if still an author) or an owner; deleted posts can't be edited.
  const canEdit = canEditPost(post.author.id) && !post.deleted;
  // A series: its parts in order, this one's place, and the next part (which "next" prefers over "read next").
  const parts = post.series?.parts ?? [];
  const partIndex = parts.findIndex((part) => part.id === post.id);
  const nextPart = partIndex >= 0 ? parts[partIndex + 1] : undefined;
  const next = nextPart ?? related[0];
  const showNext = atEnd && next !== undefined;
  const viewCount = views ?? post.viewCount;

  // Double-tap (or double-click) the banner to like, with a heart where the finger was.
  const onHeroTap = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest('a')) return;
    const { time, x, y } = lastTap.current;
    if (event.timeStamp - time < 320 && Math.hypot(event.clientX - x, event.clientY - y) < 40) {
      lastTap.current.time = 0;
      const box = event.currentTarget.getBoundingClientRect();
      setBursts((list) => [...list, { id: event.timeStamp, x: event.clientX - box.left, y: event.clientY - box.top }]);
      window.getSelection()?.removeAllRanges();
      if (!isLiked(post.id)) {
        toggleLike(post.id, post.likeCount);
        track('double_tap_like');
      }
    } else {
      lastTap.current = { time: event.timeStamp, x: event.clientX, y: event.clientY };
    }
  };

  return (
    <article className="post-page container">
      {backInBar ?? (
        <div className="post-topbar">
          <Link to="/" className="back-link">
            <ArrowLeft size={16} /> {t('post.backHome')}
          </Link>
          {/* Wide screens; narrow ones have Edit in the bottom bar. */}
          {canEdit && (
            <Link to={articlePath(post.author.username, post.id)} state={{ from: 'post' }} className="btn btn-secondary btn-sm post-edit-link">
              <SquarePen size={15} /> {t('post.edit')}
            </Link>
          )}
        </div>
      )}

      {post.deleted ? (
        <div className="notice">
          <span className="badge badge-deleted">{t('post.deleted')}</span>
          <span className="muted">{t('post.deletedNotice')}</span>
        </div>
      ) : (
        post.status !== 'published' && (
          <div className="notice">
            <span className={`badge badge-status-${post.status}`}>{t(`post.status.${post.status}`)}</span>
            {post.status === 'scheduled' && post.publishedAt && (
              <span>
                <CalendarClock size={15} /> {t('post.scheduledFor', { date: formatDateTime(post.publishedAt) })}
              </span>
            )}
            <span className="muted">{t('post.notPublic')}</span>
          </div>
        )
      )}

      <header className={`post-hero${post.bannerUrl ? '' : ' is-plain'}`} onPointerUp={onHeroTap}>
        {bursts.map((burst) => (
          <span
            key={burst.id}
            className="heart-burst"
            style={{ left: burst.x, top: burst.y }}
            aria-hidden="true"
            onAnimationEnd={() => setBursts((list) => list.filter((b) => b.id !== burst.id))}
          >
            <Heart size={84} fill="currentColor" strokeWidth={0} />
          </span>
        ))}
        {post.bannerUrl ? (
          <img className="post-hero-img" src={post.bannerUrl} alt="" />
        ) : (
          <span className="post-hero-glyph" aria-hidden="true">
            {post.category?.icon || '✦'}
          </span>
        )}
        <div className="post-hero-text">
          {trail.length > 0 && (
            <nav className="post-categories" aria-label="breadcrumb">
              {trail.map((category) => (
                <Link key={category.id} to={`/?category=${category.slug}`} className="chip chip-link">
                  {category.icon && <span aria-hidden="true">{category.icon}</span>}
                  {category.name}
                </Link>
              ))}
            </nav>
          )}
          <h1 className="post-title">{post.title}</h1>
        </div>
      </header>

      <div className="post-meta">
        {post.status === 'published' && post.publishedAt && (
          <span>
            <CalendarDays size={15} /> {t('post.publishedOn', { date: formatDate(post.publishedAt) })}
          </span>
        )}
        <span>
          <Clock size={15} /> {t('post.readingTime', { n: post.readingMinutes })}
        </span>
        {viewCount > 0 && (
          <span>
            <Eye size={15} /> {plural('post.views', viewCount)}
          </span>
        )}
      </div>

      <div className="post-layout">
        <div className="post-main">
          {post.series && parts.length > 1 && (
            <nav className="series-box" aria-label={t('series.label')}>
              <p className="series-box-head">
                <span className="series-box-label">{t('series.label')}</span>
                <strong>{post.series.title}</strong>
                {partIndex >= 0 && <span className="series-box-part">{t('series.part', { part: partIndex + 1, total: parts.length })}</span>}
              </p>
              <ol className="series-box-parts">
                {parts.map((part) => (
                  <li key={part.id} className={part.id === post.id ? 'is-current' : ''}>
                    {part.id === post.id ? <span aria-current="page">{part.title}</span> : <Link to={`/posts/${part.slug}`}>{part.title}</Link>}
                  </li>
                ))}
              </ol>
            </nav>
          )}

          {/* Sanitized on the server when the post is saved. */}
          <div ref={contentRef} className="prose post-content" dangerouslySetInnerHTML={{ __html: post.contentHtml }} />

          {(post.tags?.length ?? 0) > 0 && (
            <nav className="post-tags" aria-label={t('post.tags')}>
              {post.tags.map((tag) => (
                <Link key={tag.slug} to={`/eticheta/${tag.slug}`} className="chip chip-link">
                  #{tag.name}
                </Link>
              ))}
            </nav>
          )}

          {nextPart && (
            <Link to={`/posts/${nextPart.slug}`} className="series-next card">
              <span className="series-next-text">
                <span className="series-next-label">{t('series.next')}</span>
                <strong>{nextPart.title}</strong>
              </span>
              <ArrowRight size={20} />
            </Link>
          )}

          <div className="post-end card">
            <p className="post-end-text">{t('post.helpful')}</p>
            <div className="post-actions">
              <LikeButton post={post} large />
              <ShareButton post={post} large />
            </div>
          </div>

          {post.status === 'published' && !post.deleted && <NewsletterSignup />}

          {/* Narrow screens only: the author, in place of the sidebar's Author card. */}
          <div className="post-signature">
            <AuthorSignature author={post.author}>
              <FollowButton authorId={post.author.id} followers={post.author.followers ?? 0} />
            </AuthorSignature>
          </div>

          {/* Narrow screens only: "Read next" moves here from the sidebar, as wide cards. */}
          {related.length > 0 && (
            <section className="post-related" aria-labelledby="related-title">
              <h2 id="related-title">{t('post.related')}</h2>
              <div className="related-cards">
                {related.map((item) => (
                  <Link key={item.id} to={`/posts/${item.slug}`} className="related-card">
                    <span className="related-card-media" aria-hidden="true">
                      {item.bannerUrl ? <img src={item.bannerUrl} alt="" loading="lazy" /> : item.category?.icon || '✦'}
                    </span>
                    <span className="related-card-body">
                      <span className="related-card-title">{item.title}</span>
                      {item.excerpt && <span className="related-card-excerpt">{item.excerpt}</span>}
                      <span className="related-meta">
                        {item.publishedAt && formatShortDate(item.publishedAt)} · {t('post.readingTime', { n: item.readingMinutes })}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <Comments postId={post.id} postAuthorId={post.author.id} commentsEnabled={post.commentsEnabled} onCountChange={setCommentCount} />
        </div>

        <aside className="post-side">
          <div className="card side-card side-actions">
            <div className="post-actions">
              <LikeButton post={post} large />
              <ShareButton post={post} large />
              {post.commentsEnabled && (
                <a href="#discussion-title" className="reaction-btn reaction-btn-lg" title={t('post.comments')}>
                  <MessageCircle size={20} />
                  <span>{commentCount}</span>
                </a>
              )}
            </div>
          </div>

          {/* Administrators don't save posts. */}
          {!isOwner && (
            <div className="card side-save">
              <BookmarkButton postId={post.id} large />
            </div>
          )}

          {toc.length > 0 && (
            <nav className="card side-card" aria-label={t('post.toc')}>
              <p className="side-title">{t('post.toc')}</p>
              <ol className="toc">
                {toc.map((entry) => (
                  <li key={entry.id} className={`toc-level-${entry.level}`}>
                    <a
                      href={`#${entry.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        document.getElementById(entry.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        history.replaceState(null, '', `#${entry.id}`);
                      }}
                    >
                      {entry.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          <div className="card side-card">
            <AuthorSignature author={post.author}>
              <FollowButton authorId={post.author.id} followers={post.author.followers ?? 0} />
            </AuthorSignature>
          </div>

          {related.length > 0 && (
            <div className="card side-card">
              <p className="side-title">{t('post.related')}</p>
              <div className="related">
                {related.map((item) => (
                  <Link key={item.id} to={`/posts/${item.slug}`} className="related-item">
                    <span className="related-thumb" aria-hidden="true">
                      {item.bannerUrl ? <img src={item.bannerUrl} alt="" loading="lazy" /> : item.category?.icon || '✦'}
                    </span>
                    <span>
                      <span className="related-title">{item.title}</span>
                      <span className="related-meta">
                        {item.publishedAt && formatShortDate(item.publishedAt)} · {t('post.readingTime', { n: item.readingMinutes })}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Narrow screens only: the sidebar's actions card becomes a bar fixed to the bottom of the screen,
          with a round Home button in the middle (back to the articles). */}
      <div ref={barRef} className={`post-bar${barHidden ? ' is-hidden' : ''}`}>
        {/* At the end of the text: what's next, above the bar. */}
        {showNext && (
          <Link key={next.id} to={`/posts/${next.slug}`} className="post-bar-next" onClick={() => track('next_pill')}>
            <span className="post-bar-next-text">
              <span className="post-bar-next-label">{t('post.upNext')}</span>
              <span className="post-bar-next-title">{next.title}</span>
            </span>
            <ArrowRight size={18} />
          </Link>
        )}
        <div className="post-bar-bg" aria-hidden="true" />
        <div className="post-bar-inner">
          <div className="post-bar-group post-bar-left">
            <LikeButton post={post} large />
            {/* Administrators don't save posts: the discussion takes the place (their right side has Edit). */}
            {isOwner ? (
              post.commentsEnabled && (
                <a href="#discussion-title" className="reaction-btn reaction-btn-lg" aria-label={t('post.comments')} onClick={() => track('bar:comments')}>
                  <MessageCircle size={20} />
                  <span>{commentCount}</span>
                </a>
              )
            ) : (
              <BookmarkButton postId={post.id} large />
            )}
          </div>
          {/* Home while reading (its ring fills as the text is read), the next article once it's done. */}
          {showNext ? (
            <Link
              to={`/posts/${next.slug}`}
              className="post-bar-home is-next"
              aria-label={t('post.nextArticle')}
              title={t('post.nextArticle')}
              onClick={() => track('bar:next')}
            >
              <ArrowRight size={24} />
            </Link>
          ) : (
            <Link to="/" className="post-bar-home" aria-label={t('post.backHome')} title={t('post.backHome')} onClick={() => track('bar:home')}>
              <House size={24} />
            </Link>
          )}
          <svg className="post-bar-progress" viewBox="0 0 66 66" aria-hidden="true">
            <circle cx="33" cy="33" r="30.5" pathLength="100" />
          </svg>
          {/* Edit for the post's author and owners, the discussion for everyone else; with neither, Share fills both slots. */}
          <div className="post-bar-group post-bar-right">
            {canEdit ? (
              <Link to={articlePath(post.author.username, post.id)} state={{ from: 'post' }} className="reaction-btn reaction-btn-lg" onClick={() => track('bar:edit')}>
                <SquarePen size={20} />
                <span>{t('post.edit')}</span>
              </Link>
            ) : (
              post.commentsEnabled && (
                <a href="#discussion-title" className="reaction-btn reaction-btn-lg" aria-label={t('post.comments')} onClick={() => track('bar:comments')}>
                  <MessageCircle size={20} />
                  <span>{commentCount}</span>
                </a>
              )
            )}
            <ShareButton post={post} large />
          </div>
        </div>
      </div>
    </article>
  );
}
