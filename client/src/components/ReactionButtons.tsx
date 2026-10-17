import { Bookmark, Heart } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useAuth } from '@/context/auth';
import { useReactions } from '@/context/reactions';
import { useI18n } from '@/lib/i18n';

const stop = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

export function LikeButton({ post, large }: { post: { id: number; likeCount: number }; large?: boolean }) {
  const { isLiked, likeCount, toggleLike } = useReactions();
  const { t } = useI18n();
  const liked = isLiked(post.id);
  const label = liked ? t('post.unlike') : t('post.like');

  return (
    <button
      type="button"
      className={`reaction-btn like-btn${liked ? ' is-on' : ''}${large ? ' reaction-btn-lg' : ''}`}
      aria-pressed={liked}
      aria-label={label}
      title={label}
      onClick={(event) => {
        stop(event);
        toggleLike(post.id, post.likeCount);
      }}
    >
      <Heart size={large ? 20 : 17} fill={liked ? 'currentColor' : 'none'} />
      <span>{likeCount(post.id, post.likeCount)}</span>
    </button>
  );
}

/**
 * When saved, the visible text is the short "Saved"; the accessible name says what a click does ("Remove from saved").
 * Administrators don't save posts: there's none for them.
 */
export function BookmarkButton({ postId, large }: { postId: number; large?: boolean }) {
  const { isBookmarked, toggleBookmark } = useReactions();
  const { isOwner } = useAuth();
  const { t } = useI18n();
  if (isOwner) return null;
  const saved = isBookmarked(postId);
  const label = saved ? t('post.unbookmark') : t('post.bookmark');
  const text = saved ? t('post.saved') : label;

  return (
    <button
      type="button"
      className={`reaction-btn bookmark-btn${saved ? ' is-on' : ''}${large ? ' reaction-btn-lg' : ''}`}
      aria-pressed={saved}
      aria-label={label}
      title={label}
      onClick={(event) => {
        stop(event);
        toggleBookmark(postId);
      }}
    >
      <Bookmark size={large ? 20 : 17} fill={saved ? 'currentColor' : 'none'} />
      {large && <span>{text}</span>}
    </button>
  );
}
