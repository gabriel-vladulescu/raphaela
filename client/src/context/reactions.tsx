import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/context/auth';
import { buzz, track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { showToast } from '@/lib/toast';

// Likes are public and live on the server for everyone (a guest's are tied to their browser, and move into their
// account when they sign in). Saved posts need an account; a guest's stay in localStorage until they sign in.
const OLD_GUEST_LIKES = 'guest.likes'; // from before likes were public: sent to the server once
const GUEST_BOOKMARKS = 'guest.bookmarks';
const SAVE_NUDGE = 'nudge.save';

function readIds(key: string): number[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is number => Number.isSafeInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: number[]) {
  try {
    if (ids.length) localStorage.setItem(key, JSON.stringify(ids));
    else localStorage.removeItem(key);
  } catch {
    // Storage unavailable: the state still works until the page is reloaded.
  }
}

/** A one-time flag in localStorage; true the first time it's asked for. */
function firstTime(key: string) {
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

interface Reactions {
  likes: number[];
  bookmarks: number[];
}

interface ReactionsValue {
  isLiked: (postId: number) => boolean;
  isBookmarked: (postId: number) => boolean;
  /** Like count to display, given the count the server sent with the post. */
  likeCount: (postId: number, serverCount: number) => number;
  toggleLike: (postId: number, serverCount: number) => void;
  toggleBookmark: (postId: number) => void;
  /** Bookmarked post ids, most recent first. */
  bookmarks: number[];
}

const ReactionsContext = createContext<ReactionsValue | null>(null);

export function ReactionsProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const userId = user?.id;
  const [likes, setLikes] = useState<number[]>([]);
  const [bookmarks, setBookmarks] = useState<number[]>(() => readIds(GUEST_BOOKMARKS));
  const [counts, setCounts] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    if (loading) return;
    setCounts(new Map());
    let cancelled = false;
    const oldLikes = readIds(OLD_GUEST_LIKES);
    const guestBookmarks = readIds(GUEST_BOOKMARKS);
    const request = userId
      ? oldLikes.length || guestBookmarks.length
        ? api<Reactions>('/me/reactions/import', { method: 'POST', body: { likes: oldLikes, bookmarks: guestBookmarks } })
        : api<Reactions>('/reactions')
      : oldLikes.length
        ? api<Reactions>('/likes/import', { method: 'POST', body: { likes: oldLikes } })
        : api<Reactions>('/reactions');
    request
      .then((data) => {
        writeIds(OLD_GUEST_LIKES, []);
        if (userId) writeIds(GUEST_BOOKMARKS, []);
        if (cancelled) return;
        setLikes(data.likes);
        setBookmarks(userId ? data.bookmarks : readIds(GUEST_BOOKMARKS));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId, loading]);

  const likeCount = useCallback((postId: number, serverCount: number) => counts.get(postId) ?? serverCount, [counts]);

  const toggleLike = useCallback(
    (postId: number, serverCount: number) => {
      const wasLiked = likes.includes(postId);
      setLikes((current) => (wasLiked ? current.filter((id) => id !== postId) : [...current, postId]));
      const shown = likeCount(postId, serverCount);
      setCounts((current) => new Map(current).set(postId, Math.max(0, shown + (wasLiked ? -1 : 1))));
      buzz();
      api<{ likeCount: number }>(`/posts/${postId}/like`, { method: wasLiked ? 'DELETE' : 'PUT' })
        .then((data) => {
          setCounts((current) => new Map(current).set(postId, data.likeCount));
          track(wasLiked ? 'unlike' : 'like', postId);
        })
        .catch(() => {
          setLikes((current) => (wasLiked ? [...current, postId] : current.filter((id) => id !== postId)));
          setCounts((current) => new Map(current).set(postId, shown));
        });
    },
    [likes, likeCount],
  );

  const toggleBookmark = useCallback(
    (postId: number) => {
      const wasSaved = bookmarks.includes(postId);
      const next = wasSaved ? bookmarks.filter((id) => id !== postId) : [postId, ...bookmarks];
      setBookmarks(next);
      buzz();
      track(wasSaved ? 'unsave' : 'save', postId);
      if (!userId) {
        writeIds(GUEST_BOOKMARKS, next);
        // A guest's first save: it only lives in this browser, which an account fixes.
        if (!wasSaved && firstTime(SAVE_NUDGE)) {
          const back = window.location.pathname;
          showToast({
            message: t('toast.saveNudge'),
            action: { label: t('toast.saveNudgeAction'), to: `/register?next=${encodeURIComponent(back)}`, onClick: () => track('signup_nudge') },
          });
        }
        return;
      }
      api(`/posts/${postId}/bookmark`, { method: wasSaved ? 'DELETE' : 'PUT' }).catch(() =>
        setBookmarks((current) => (wasSaved ? [postId, ...current] : current.filter((id) => id !== postId))),
      );
    },
    [bookmarks, userId, t],
  );

  const value = useMemo(
    () => ({
      isLiked: (postId: number) => likes.includes(postId),
      isBookmarked: (postId: number) => bookmarks.includes(postId),
      likeCount,
      toggleLike,
      toggleBookmark,
      bookmarks,
    }),
    [likes, bookmarks, likeCount, toggleLike, toggleBookmark],
  );
  return <ReactionsContext.Provider value={value}>{children}</ReactionsContext.Provider>;
}

export function useReactions(): ReactionsValue {
  const value = useContext(ReactionsContext);
  if (!value) throw new Error('useReactions must be used inside <ReactionsProvider>');
  return value;
}
