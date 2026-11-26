import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarClock,
  CalendarDays,
  Clock,
  Eye,
  Headphones,
  Heart,
  House,
  MessageCircle,
  Square,
  SquarePen,
} from 'lucide-react';
import { ChapterContentsButton, ChapterEnd, ChapterOnward, ChapterOpening, chapterPlace, ChapterSideCard } from '@/components/Chapter';
import { AuthorSignature } from '@/components/AuthorSignature';
import { BackToTop } from '@/components/BackToTop';
import { BannerCredit } from '@/components/BannerCredit';
import { Comments } from '@/components/Comments';
import { FollowButton, followAuthors } from '@/components/FollowButton';
import { NewsletterSignup } from '@/components/NewsletterSignup';
import { BookmarkButton, LikeButton } from '@/components/ReactionButtons';
import { ShareButton } from '@/components/ShareSheet';
import { TagChip } from '@/components/TagChip';
import { site, siteSettings } from '@/config';
import { useAuth } from '@/context/auth';
import { useCategories } from '@/context/categories';
import { useReactions } from '@/context/reactions';
import { setReadProgress, track, trackPage } from '@/lib/analytics';
import { api, ApiError } from '@/lib/api';
import { categoryPath } from '@/lib/categories';
import { bookPath, chapterEditorPath, chapterPath, roman } from '@/lib/books';
import { articlePath, postPath } from '@/lib/paths';
import { recordProgress } from '@/lib/reading';
import { canSpeak, speak, stopSpeaking, useSpeaking } from '@/lib/speech';
import { useHeaderSlot } from '@/lib/headerSlot';
import { useI18n } from '@/lib/i18n';
import { finishedReading, offerNewsletter } from '@/lib/newsletterSheet';
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

/** A post (/posts/{slug}), or a chapter of a book (/carti/{book}/{slug}): the same page, the chapter's with its book. */
export function PostPage() {
  const { slug = '', book: bookSlug } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { user, isOwner, canEditPost } = useAuth();
  const { categories } = useCategories();
  const { t, lang, plural, formatDate, formatShortDate, formatDateTime } = useI18n();
  const [params, setParams] = useSearchParams();
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
    api<{ post: Post }>(bookSlug ? `/books/${encodeURIComponent(bookSlug)}/chapters/${encodeURIComponent(slug)}` : `/posts/${encodeURIComponent(slug)}`)
      .then((data) => {
        if (cancelled) return;
        setPost(data.post);
        setCommentCount(data.post.commentCount);
      })
      .catch((err) => {
        if (cancelled) return;
        // Its address changed (its title did, or it's a chapter, read under its book): on to the new one, in place
        // of the old in the history.
        if (err instanceof ApiError && err.code === 'moved' && typeof err.data.path === 'string') {
          navigate(`${err.data.path}${hash}`, { replace: true });
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
  }, [slug, bookSlug, user?.id, user?.role]);

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

  // How far the reader got, for "continue reading" and their journeys through the books (lib/reading.ts): kept
  // every tenth of the text, at the end, and when they leave.
  const signedIn = Boolean(user);
  const furthest = useRef(0);
  const saved = useRef(0);
  useEffect(() => {
    if (!postId) return;
    furthest.current = 0;
    saved.current = 0;
    const flush = () => {
      if (furthest.current >= 3 && furthest.current > saved.current) {
        saved.current = furthest.current;
        void recordProgress(postId, furthest.current, signedIn);
      }
    };
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    const timer = window.setInterval(flush, 15_000);
    return () => {
      flush();
      document.removeEventListener('visibilitychange', onHide);
      window.clearInterval(timer);
    };
  }, [postId, signedIn]);

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
      const percent = Math.round(progress * 100);
      if (percent > furthest.current) {
        furthest.current = percent;
        // Saved at each tenth (and at the end) as it goes.
        if (percent >= saved.current + 10 || (percent >= 100 && saved.current < 100)) {
          saved.current = percent;
          void recordProgress(postId, percent, signedIn);
        }
      }
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

  // Narrow screens (no newsletter box there): a post read to the end counts toward offering the newsletter
  // (lib/newsletterSheet.ts), offered a moment after the end of an article, not before a quarter of a minute on the
  // page. Not at the end of a chapter: there the way on comes first.
  const openedAt = useRef(Date.now());
  useEffect(() => {
    openedAt.current = Date.now();
  }, [postId]);
  const readToEnd = Boolean(post && post.status === 'published' && !post.deleted);
  const isChapter = Boolean(post?.book);
  useEffect(() => {
    if (!atEnd || !narrow || !postId || !readToEnd || !siteSettings.newsletter) return;
    finishedReading(postId);
    if (isChapter) return;
    const wait = Math.max(1500, openedAt.current + 15_000 - Date.now());
    const timer = window.setTimeout(() => void offerNewsletter(signedIn), wait);
    return () => window.clearTimeout(timer);
  }, [atEnd, narrow, postId, readToEnd, isChapter, signedIn]);

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

  // "Read next": the same category first, topped up with the latest posts. A book's chapter has its next chapter.
  useEffect(() => {
    if (!post || post.book) {
      setRelated([]);
      return;
    }
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

  // Listening (the browser reads the text aloud); ?asculta=1 (from "Listen" elsewhere) starts it.
  const speechId = `post-${postId ?? 0}`;
  const speaking = useSpeaking(speechId);
  const listen = () => {
    if (speaking) return stopSpeaking();
    const text = contentRef.current?.innerText ?? '';
    if (post && text) speak(speechId, `${post.title}.\n${text}`, lang);
  };
  useEffect(() => {
    if (!postId || params.get('asculta') !== '1') return;
    const next = new URLSearchParams(params);
    next.delete('asculta');
    setParams(next, { replace: true });
    if (canSpeak()) window.setTimeout(listen, 300);
  }, [postId]);

  // Back: to the book, for a chapter; to the journal, for an article.
  const back = post?.book && post.slug === slug ? { to: bookPath(post.book.slug), label: post.book.title } : { to: '/jurnal', label: t('post.backHome') };

  // Narrow screens (with the bottom bar): "Back to posts" sits in the top bar, left of its buttons, which saves a
  // line above the banner. Wide screens have it on that line, with Edit at its other end.
  const backInBar =
    narrow && headerSlot
      ? createPortal(
          <Link to={back.to} className="back-link">
            <ArrowLeft size={16} /> <span className="back-link-text">{back.label}</span>
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
          <Link to="/jurnal" className="btn btn-secondary">
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
  // A chapter: its place in the book, and the chapter after it (open, or coming on a date).
  const book = post.book;
  const place = book ? chapterPlace(book, post.id) : null;
  const nextChapter = book && place?.after?.slug ? { id: place.after.id, title: place.after.title, path: chapterPath(book.slug, place.after.slug) } : undefined;
  // What's next: the next chapter, or else something to read next.
  const next = nextChapter ?? (related[0] && { id: related[0].id, title: related[0].title, path: postPath(related[0]) });
  // Editing it: an article, or a chapter of its book.
  const editPath = book ? chapterEditorPath(book.id, post.id) : articlePath(post.id);
  const showNext = atEnd && next !== undefined;
  /** A chapter's text is read: the bar shows the way on (ChapterOnward). */
  const chapterEnd = Boolean(place) && atEnd;
  const viewCount = views ?? post.viewCount;
  // Follow beside the author (only where the site has more than one author).
  const follow = followAuthors() ? <FollowButton authorId={post.author.id} followers={post.author.followers ?? 0} /> : undefined;

  // When it was published, how long it takes, its views, and "Listen": under an article's banner, inside a chapter's opening.
  const metaItems = (
    <>
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
      {canSpeak() && (
        <button type="button" className={`listen-btn${speaking ? ' is-on' : ''}`} onClick={listen} aria-pressed={speaking}>
          {speaking ? <Square size={13} fill="currentColor" /> : <Headphones size={15} />} {speaking ? t('books.stopListening') : t('today.listen')}
        </button>
      )}
    </>
  );

  // The hearts a double tap leaves where the finger was (on the banner, or a chapter's opening).
  const heartBursts = bursts.map((burst) => (
    <span
      key={burst.id}
      className="heart-burst"
      style={{ left: burst.x, top: burst.y }}
      aria-hidden="true"
      onAnimationEnd={() => setBursts((list) => list.filter((b) => b.id !== burst.id))}
    >
      <Heart size={84} fill="currentColor" strokeWidth={0} />
    </span>
  ));

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
    <article className={`post-page container${book ? ' is-chapter' : ''}`}>
      {backInBar ?? (
        <div className="post-topbar">
          <Link to={back.to} className="back-link">
            <ArrowLeft size={16} /> {back.label}
          </Link>
          {/* Wide screens; narrow ones have Edit in the bottom bar. */}
          {canEdit && (
            <Link to={editPath} state={{ from: 'post' }} className="btn btn-secondary btn-sm post-edit-link">
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

      {book && place ? (
        <ChapterOpening
          book={book}
          place={place}
          title={post.title || t('post.untitled')}
          meta={metaItems}
          onPointerUp={onHeroTap}
          bursts={heartBursts}
        />
      ) : (
      <header className={`post-hero${post.bannerUrl ? '' : ' is-plain'}`} onPointerUp={onHeroTap}>
        {heartBursts}
        {post.bannerUrl ? (
          <>
            <img className="post-hero-img" src={post.bannerUrl} alt="" />
            <BannerCredit credit={post.bannerCredit} />
          </>
        ) : (
          <span className="post-hero-glyph" aria-hidden="true">
            {post.category?.icon || '✦'}
          </span>
        )}
        <div className="post-hero-text">
          {trail.length > 0 && (
            <nav className="post-categories" aria-label="breadcrumb">
              {trail.map((category) => (
                <Link key={category.id} to={`/jurnal?category=${category.slug}`} className="chip chip-link">
                  {category.icon && <span aria-hidden="true">{category.icon}</span>}
                  {category.name}
                </Link>
              ))}
            </nav>
          )}
          <h1 className="post-title">{post.title || t('post.untitled')}</h1>
        </div>
      </header>
      )}

      {!book && <div className="post-meta">{metaItems}</div>}

      <div className="post-layout">
        <div className="post-main">
          {/* Sanitized on the server when the post is saved. */}
          <div ref={contentRef} className="prose post-content" dangerouslySetInnerHTML={{ __html: post.contentHtml }} />

          {(post.tags?.length ?? 0) > 0 && (
            <nav className="post-tags" aria-label={t('post.tags')}>
              {post.tags.map((tag) => (
                <TagChip key={tag.slug} tag={tag} to={`/eticheta/${tag.slug}`} />
              ))}
            </nav>
          )}

          {book && place ? (
            <ChapterEnd book={book} place={place} />
          ) : (
            <div className="post-end card">
              <p className="post-end-text">{t('post.helpful')}</p>
              <div className="post-actions">
                <LikeButton post={post} large />
                <ShareButton post={post} large />
              </div>
            </div>
          )}

          {/* Not after a chapter: there, "Notify me" takes its place while the next one isn't out. Not on narrow
              screens either: there it's in the account menu, and offered at the end now and then. */}
          {post.status === 'published' && !post.deleted && !book && !narrow && <NewsletterSignup />}

          {/* Narrow screens only: the author, in place of the sidebar's Author card (compact). */}
          <div className="post-signature card">
            <AuthorSignature
              compact
              author={post.author}
              label={book ? t('books.bookAuthor') : t('post.aboutAuthor')}
              action={follow}
            />
          </div>

          {/* Narrow screens only: "Read next" moves here from the sidebar, as the rows of "My books" and "My journal":
              the picture, its book or category as a chip, the title, when and how long. */}
          {related.length > 0 && (
            <section className="post-related" aria-labelledby="related-title">
              <h2 id="related-title">{t('post.related')}</h2>
              <div className="related-cards">
                {related.map((item) => (
                  <Link key={item.id} to={postPath(item)} className="related-card glass">
                    <span className="journal-thumb related-card-thumb" aria-hidden="true">
                      {item.bannerUrl ? <img src={item.bannerUrl} alt="" loading="lazy" /> : <span>{item.category?.icon || '✦'}</span>}
                    </span>
                    <span className="related-card-text">
                      {(item.book || item.category) && (
                        <span className="book-chip">
                          {item.book
                            ? `${item.book.title} · ${t('today.chapterRoman', { n: roman(item.book.chapter) })}`
                            : `${item.category!.icon ? `${item.category!.icon} ` : ''}${item.category!.name}`}
                        </span>
                      )}
                      <span className="related-card-title">{item.title}</span>
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
          {book && place && <ChapterSideCard book={book} place={place} postId={post.id} />}

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
            <nav className="card side-card" aria-label={book ? t('books.inThisChapter') : t('post.toc')}>
              <p className="side-title">{book ? t('books.inThisChapter') : t('post.toc')}</p>
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
            <AuthorSignature
              author={post.author}
              label={book ? t('books.bookAuthor') : t('post.aboutAuthor')}
              action={follow}
              side
            />
          </div>

          {related.length > 0 && (
            <div className="card side-card">
              <p className="side-title">{t('post.related')}</p>
              <div className="related">
                {related.map((item) => (
                  <Link key={item.id} to={postPath(item)} className="related-item">
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
          with a round Home button in the middle (back to the articles). At the end of a chapter's text it becomes
          the way on instead (and stays in view). */}
      <div ref={barRef} className={`post-bar${book ? ' is-chapter' : ''}${barHidden && !chapterEnd ? ' is-hidden' : ''}`}>
        {/* At the end of an article's text: what's next, above the bar. */}
        {showNext && !book && (
          <Link key={next.id} to={next.path} className="post-bar-next" onClick={() => track('next_pill')}>
            <span className="post-bar-next-text">
              <span className="post-bar-next-label">{t('post.upNext')}</span>
              <span className="post-bar-next-title">{next.title}</span>
            </span>
            <ArrowRight size={18} />
          </Link>
        )}
        <div className="post-bar-bg" aria-hidden="true" />
        {chapterEnd && book && place ? (
          <div className="post-bar-inner post-bar-end">
            <ChapterContentsButton book={book} place={place} postId={post.id} compact />
            <LikeButton post={post} large />
            <ShareButton post={post} />
            <ChapterOnward book={book} place={place} onGo={() => track('bar:next')} />
          </div>
        ) : (
        <div className="post-bar-inner">
          <div className="post-bar-group post-bar-left">
            {/* A chapter: the book's contents first. */}
            {book && place && <ChapterContentsButton book={book} place={place} postId={post.id} />}
            <LikeButton post={post} large />
            {/* Administrators don't save posts: the discussion takes the place (their right side has Edit). */}
            {book ? null : isOwner ? (
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
              to={next.path}
              className="post-bar-home is-next"
              aria-label={t('post.nextArticle')}
              title={t('post.nextArticle')}
              onClick={() => track('bar:next')}
            >
              <ArrowRight size={24} />
            </Link>
          ) : (
            <Link to={back.to} className="post-bar-home" aria-label={back.label} title={back.label} onClick={() => track('bar:home')}>
              {book ? <BookOpen size={23} /> : <House size={24} />}
            </Link>
          )}
          <svg className="post-bar-progress" viewBox="0 0 66 66" aria-hidden="true">
            <circle cx="33" cy="33" r="30.5" pathLength="100" />
          </svg>
          {/* Edit for the post's author and owners, the discussion for everyone else; with neither, Share fills both slots. */}
          <div className="post-bar-group post-bar-right">
            {canEdit ? (
              <Link to={editPath} state={{ from: 'post' }} className="reaction-btn reaction-btn-lg" onClick={() => track('bar:edit')}>
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
        )}
      </div>
      <BackToTop />
    </article>
  );
}
