import { Link } from 'react-router';
import { Eye, MessageCircle } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { BookmarkButton, LikeButton } from '@/components/ReactionButtons';
import { ShareButton } from '@/components/ShareSheet';
import { useI18n } from '@/lib/i18n';
import type { PostSummary } from '@/lib/types';

/** Newer than this, a feed post says how long ago it came out ("3 h", "2 z"); older ones show the date. */
const RECENT_MS = 7 * 86_400_000;

/** The whole card links to the post (via the title's stretched link); buttons and chips stay clickable. */
export function PostCard({ post, featured }: { post: PostSummary; featured?: boolean }) {
  const { t, formatShortDate } = useI18n();

  return (
    <article className={`post-card${featured ? ' post-card-featured' : ''}`}>
      <div className="post-card-media">
        {post.bannerUrl ? (
          <img src={post.bannerUrl} alt="" loading="lazy" />
        ) : (
          <div className="post-card-placeholder" aria-hidden="true">
            <span>{post.category?.icon || '✦'}</span>
          </div>
        )}
      </div>

      <div className="post-card-body">
        <div className="post-card-tags">
          {featured && <span className="badge badge-featured">{t('home.featured')}</span>}
          {post.category && (
            <Link to={`/?category=${post.category.slug}`} className="chip chip-link">
              {post.category.icon && <span aria-hidden="true">{post.category.icon}</span>}
              {post.category.name}
            </Link>
          )}
        </div>

        <h3 className="post-card-title">
          <Link to={`/posts/${post.slug}`}>{post.title}</Link>
        </h3>
        <p className="post-card-excerpt">{post.excerpt}</p>
        <p className="post-card-meta muted small">
          {post.publishedAt && <time dateTime={post.publishedAt}>{formatShortDate(post.publishedAt)}</time>}
          <span aria-hidden="true">·</span>
          <span>{t('post.readingTime', { n: post.readingMinutes })}</span>
        </p>

        <div className="post-card-footer">
          <div className="post-card-author">
            <Avatar name={post.author.name} picture={post.author.picture} size={28} />
            <span className="author-name">{post.author.name}</span>
          </div>
          <div className="post-card-actions">
            <LikeButton post={post} />
            {post.commentsEnabled && (
              <span className="reaction-static" title={t('post.comments')}>
                <MessageCircle size={17} />
                {post.commentCount}
              </span>
            )}
            <BookmarkButton postId={post.id} />
          </div>
        </div>
      </div>
    </article>
  );
}

export function PostCardSkeleton() {
  return (
    <div className="post-card post-card-skeleton" aria-hidden="true">
      <div className="post-card-media skeleton" />
      <div className="post-card-body">
        <div className="skeleton skeleton-line" style={{ width: '30%' }} />
        <div className="skeleton skeleton-line skeleton-title" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line" style={{ width: '70%' }} />
      </div>
    </div>
  );
}

/**
 * Narrow screens: a post in the home feed, the way social apps show one. Who wrote it and when, its category, the title and
 * excerpt, the picture across the whole screen, then like, comments, share, views and save. The whole item opens
 * the post (the title's stretched link); its buttons and links stay clickable above it.
 */
export function FeedPost({ post, featured }: { post: PostSummary; featured?: boolean }) {
  const { t, plural, formatShortDate, formatNumber, timeShort } = useI18n();
  const recent = post.publishedAt !== null && Date.now() - new Date(post.publishedAt).getTime() < RECENT_MS;

  return (
    <article className="feed-post">
      <header className="feed-post-head">
        <Avatar name={post.author.name} picture={post.author.picture} size={40} />
        <div className="feed-post-byline">
          <span className="feed-post-author">{post.author.name}</span>
          <span className="feed-post-when">
            {post.publishedAt && (
              <>
                <time dateTime={post.publishedAt} title={formatShortDate(post.publishedAt)}>
                  {recent ? timeShort(post.publishedAt) : formatShortDate(post.publishedAt)}
                </time>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>{t('post.readingTime', { n: post.readingMinutes })}</span>
          </span>
        </div>
        {post.category && (
          <Link to={`/?category=${post.category.slug}`} className="chip chip-link feed-post-category">
            {post.category.icon && <span aria-hidden="true">{post.category.icon}</span>}
            <span className="feed-post-category-name">{post.category.name}</span>
          </Link>
        )}
      </header>

      <div className="feed-post-text">
        {featured && <span className="badge badge-featured">{t('home.featured')}</span>}
        <h2 className="feed-post-title">
          <Link to={`/posts/${post.slug}`}>{post.title}</Link>
        </h2>
        <p className="feed-post-excerpt">{post.excerpt}</p>
      </div>

      <div className="feed-post-media">
        {post.bannerUrl ? (
          <img src={post.bannerUrl} alt="" loading="lazy" />
        ) : (
          <div className="post-card-placeholder" aria-hidden="true">
            <span>{post.category?.icon || '✦'}</span>
          </div>
        )}
      </div>

      <footer className="feed-post-actions">
        <LikeButton post={post} />
        {post.commentsEnabled && (
          <Link to={`/posts/${post.slug}#discussion-title`} className="reaction-btn" aria-label={t('post.comments')} title={t('post.comments')}>
            <MessageCircle size={17} />
            <span>{post.commentCount}</span>
          </Link>
        )}
        <ShareButton post={post} />
        <span className="feed-post-views" title={plural('post.views', post.viewCount)}>
          <Eye size={16} aria-hidden="true" />
          {formatNumber(post.viewCount)}
        </span>
        <BookmarkButton postId={post.id} />
      </footer>
    </article>
  );
}

export function FeedPostSkeleton() {
  return (
    <div className="feed-post feed-post-skeleton" aria-hidden="true">
      <div className="feed-post-head">
        <div className="skeleton feed-post-skeleton-avatar" />
        <div className="feed-post-byline">
          <div className="skeleton skeleton-line" style={{ width: '45%' }} />
          <div className="skeleton skeleton-line" style={{ width: '30%' }} />
        </div>
      </div>
      <div className="feed-post-text">
        <div className="skeleton skeleton-line skeleton-title" />
        <div className="skeleton skeleton-line" />
      </div>
      <div className="feed-post-media skeleton" />
    </div>
  );
}
