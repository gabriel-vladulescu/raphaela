import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { Bookmark, Lock } from 'lucide-react';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { PersonHeader } from '@/components/PersonHeader';
import { PostCard } from '@/components/PostCard';
import { useAuth } from '@/context/auth';
import { useReactions } from '@/context/reactions';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { savedPath } from '@/lib/paths';
import { usePerson } from '@/lib/people';
import type { PostSummary } from '@/lib/types';
import { GridSkeleton, PageError, PersonHeaderSkeleton, PersonMissing } from '@/pages/ArticlesPage';

/**
 * Saved posts. /articole-salvate: a guest's, kept in this browser (signed in, their own page instead).
 * /{username}/articole-salvate: someone's, theirs to see, or anyone's if they made the list public (Settings).
 */
export function SavedPage() {
  const { username } = useParams();
  const { user, loading } = useAuth();
  const { t } = useI18n();
  if (loading) return <div className="container page-loading">{t('common.loading')}</div>;
  // Administrators don't save posts.
  if (user?.role === 'owner' && (!username || username.toLowerCase() === user.username)) return <Navigate to="/admin" replace />;
  if (!username) return user ? <Navigate to={savedPath(user.username)} replace /> : <GuestSaved />;
  return <PersonSaved username={username} own={user?.username === username.toLowerCase()} />;
}

/** The viewer's own saved posts, as they save and unsave them (signed in or not); `enabled`: on their own pages. */
function useMyBookmarks(enabled = true) {
  const { bookmarks } = useReactions();
  const { errorMessage } = useI18n();
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Only fetch when a bookmark we haven't loaded appears; removals just filter the list below.
  const missing = bookmarks.filter((id) => !posts.some((post) => post.id === id));
  const missingKey = missing.join(',');

  useEffect(() => {
    if (!enabled || !missingKey) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    api<{ posts: PostSummary[] }>(`/posts?ids=${missingKey}&limit=50`)
      .then((data) => !cancelled && setPosts((current) => [...current, ...data.posts]))
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [missingKey, enabled]);

  const saved = bookmarks.map((id) => posts.find((post) => post.id === id)).filter((post): post is PostSummary => Boolean(post));
  return { saved, loading: loading && saved.length === 0, error };
}

function GuestSaved() {
  const { t } = useI18n();
  const { saved, loading, error } = useMyBookmarks();
  return (
    <div className="container">
      <HeaderBackLink />
      <section className="page-hero">
        <div className="page-hero-text">
          <h1>{t('saved.title')}</h1>
          <p className="muted">
            {t('saved.guest')} <Link to={`/login?next=${encodeURIComponent(savedPath())}`}>{t('auth.login.submit')}</Link>
          </p>
        </div>
      </section>
      <SavedGrid posts={saved} loading={loading} error={error} empty={t('saved.empty')} />
    </div>
  );
}

function PersonSaved({ username, own }: { username: string; own: boolean }) {
  const { t, errorMessage } = useI18n();
  const view = usePerson(username);
  const mine = useMyBookmarks(own);
  const [theirs, setTheirs] = useState<{ username: string; value: PostSummary[] | 'private' | 'missing' | string } | null>(null);

  // Someone else's: from the server (their own list follows what they save and unsave, as they do it).
  useEffect(() => {
    if (own) return;
    let cancelled = false;
    api<{ posts: PostSummary[] }>(`/u/${encodeURIComponent(username)}/articole-salvate`)
      .then((data) => !cancelled && setTheirs({ username, value: data.posts }))
      .catch((err) => {
        if (cancelled) return;
        const code = err instanceof ApiError ? err.code : '';
        setTheirs({ username, value: code === 'private' ? 'private' : code === 'not_found' ? 'missing' : errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [username, own]);

  const list = own ? mine.saved : theirs?.username === username ? theirs.value : null;
  if (view === 'missing' || list === 'missing') return <PersonMissing />;
  if (view === 'error') return <PageError message={t('error.generic')} />;

  return (
    <div className="container person-page">
      <HeaderBackLink />
      {view === null ? <PersonHeaderSkeleton /> : <PersonHeader view={view} list="articole-salvate" />}
      {list === 'private' ? (
        <div className="empty-state card">
          <Lock size={34} className="empty-icon" aria-hidden="true" />
          <p>{t('people.private')}</p>
        </div>
      ) : typeof list === 'string' ? (
        <p className="form-error">{list}</p>
      ) : (
        <SavedGrid
          posts={list ?? []}
          loading={own ? mine.loading : list === null}
          error={own ? mine.error : ''}
          empty={t(own ? 'saved.empty' : 'people.emptySaved')}
        />
      )}
    </div>
  );
}

function SavedGrid({ posts, loading, error, empty }: { posts: PostSummary[]; loading: boolean; error: string; empty: string }) {
  return (
    <>
      {error && <p className="form-error">{error}</p>}
      {loading ? (
        <GridSkeleton />
      ) : posts.length === 0 ? (
        <div className="empty-state card">
          <Bookmark size={36} className="empty-icon" aria-hidden="true" />
          <p>{empty}</p>
        </div>
      ) : (
        <div className="post-grid post-grid-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </>
  );
}
