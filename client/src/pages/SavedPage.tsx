import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { Bookmark, Globe, Lock } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { PageBand } from '@/components/PageBand';
import { PostCard } from '@/components/PostCard';
import { useAuth } from '@/context/auth';
import { useReactions } from '@/context/reactions';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { personListPath, savedPath } from '@/lib/paths';
import type { PostSummary } from '@/lib/types';
import { GridSkeleton } from '@/pages/ArticlesPage';

type Kind = 'all' | 'articles' | 'chapters';

/**
 * One's own saved posts (/salvate): a guest's, kept in this browser; signed in, their account's. Articles and
 * chapters, the latest saved first, with tabs to show just one kind. Whether the list is public (Settings) and its
 * public page (/{username}/salvate) are at the top. Someone else's saved posts: their public page (PersonPage).
 */
export function SavedPage() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  if (loading) return <div className="container page-loading">{t('common.loading')}</div>;
  // Administrators don't save posts.
  if (user?.role === 'owner') return <Navigate to="/admin" replace />;
  return <OwnSaved />;
}

/** The viewer's own saved posts, as they save and unsave them (signed in or not); `enabled`: on their own pages. */
export function useMyBookmarks(enabled = true) {
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

function OwnSaved() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { saved, loading, error } = useMyBookmarks();
  const [kind, setKind] = useState<Kind>('all');
  const articles = saved.filter((post) => !post.book);
  const chapters = saved.filter((post) => post.book);
  const shown = kind === 'articles' ? articles : kind === 'chapters' ? chapters : saved;
  const isPublic = Boolean(user?.publicSaved);

  return (
    <div className="container saved-page">
      <HeaderBackLink />
      <PageBand
        title={t('saved.title')}
        line={
          user ? (
            t('saved.user')
          ) : (
            <>
              {t('saved.guest')} <Link to={`/login?next=${encodeURIComponent(savedPath())}`}>{t('auth.login.submit')}</Link>
            </>
          )
        }
        actions={
          user && (
            <Link to={isPublic ? personListPath(user.username, 'salvate') : '/setari'} className="btn btn-soft btn-sm">
              {isPublic ? <Globe size={15} /> : <Lock size={15} />} {t(isPublic ? 'saved.publicPage' : 'saved.private')}
            </Link>
          )
        }
        tabsLabel={t('saved.kinds')}
        tabs={
          saved.length > 0
            ? [
                { key: 'all', label: t('saved.all'), count: saved.length, active: kind === 'all', onClick: () => setKind('all') },
                { key: 'articles', label: t('saved.articles'), count: articles.length, active: kind === 'articles', onClick: () => setKind('articles') },
                { key: 'chapters', label: t('saved.chapters'), count: chapters.length, active: kind === 'chapters', onClick: () => setKind('chapters') },
              ]
            : undefined
        }
      />
      <SavedGrid posts={shown} loading={loading} error={error} />
    </div>
  );
}

/** Saved posts as cards (a person's public list too: PersonPage); none yet: an empty state. */
export function SavedGrid({ posts, loading, error, empty }: { posts: PostSummary[]; loading: boolean; error: string; empty?: string }) {
  const { t } = useI18n();
  return (
    <>
      {error && <p className="form-error">{error}</p>}
      {loading ? (
        <GridSkeleton />
      ) : posts.length === 0 ? (
        <EmptyState icon={Bookmark} title={t('saved.emptyTitle')} text={empty ?? t('saved.empty')} />
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
