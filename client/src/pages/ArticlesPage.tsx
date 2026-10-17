import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { CalendarClock, ExternalLink, FileText, Heart, Lock, MessageCircle, Plus, SquarePen, Trash2 } from 'lucide-react';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { PersonHeader } from '@/components/PersonHeader';
import { PostCard, PostCardSkeleton } from '@/components/PostCard';
import { useAuth } from '@/context/auth';
import { useCategories } from '@/context/categories';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { articlePath, articlesPath, newArticlePath } from '@/lib/paths';
import { usePerson } from '@/lib/people';
import type { PersonView } from '@/lib/people';
import type { PostStatus, PostSummary } from '@/lib/types';

type Filter = PostStatus | 'all' | 'deleted';

const FILTERS: Filter[] = ['all', 'published', 'scheduled', 'draft', 'deleted'];

interface ArticleList {
  posts: PostSummary[];
  /** The viewer manages them (drafts and scheduled ones too): the person, or an administrator. */
  manage: boolean;
  /** An administrator's own list: every post. */
  everyone: boolean;
}

/** The old addresses (/admin/posts, /editor/new): the signed-in writer's own pages. */
export function MyPage({ to }: { to: 'articles' | 'new' }) {
  const { user } = useAuth();
  return <Navigate to={to === 'new' ? newArticlePath(user!.username) : articlesPath(user!.username)} replace />;
}

/**
 * /{username}/articole: their articles. They (and administrators) manage them here, drafts and scheduled ones
 * too; anyone else sees the published ones, if they made the list public (Settings).
 */
export function ArticlesPage() {
  const { username = '' } = useParams();
  const { t, errorMessage } = useI18n();
  const { user, loading, isOwner } = useAuth();
  const view = usePerson(username);
  const [list, setList] = useState<{ key: string; value: ArticleList | 'private' | 'missing' | string } | null>(null);
  const key = `${username.toLowerCase()}|${loading ? null : (user?.id ?? 0)}`;

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    api<ArticleList>(`/u/${encodeURIComponent(username)}/articole`)
      .then((data) => !cancelled && setList({ key, value: data }))
      .catch((err) => {
        if (cancelled) return;
        const code = err instanceof ApiError ? err.code : '';
        setList({ key, value: code === 'private' || code === 'not_found' ? (code === 'private' ? 'private' : 'missing') : errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const current = list?.key === key ? list.value : null;
  const setPosts: Dispatch<SetStateAction<PostSummary[]>> = (change) =>
    setList((state) =>
      state && typeof state.value === 'object' ? { ...state, value: { ...state.value, posts: typeof change === 'function' ? change(state.value.posts) : change } } : state,
    );

  // An administrator's own list is every post: the administration's.
  if (isOwner && user && username.toLowerCase() === user.username) return <Navigate to="/admin/articole" replace />;
  if (view === 'missing' || current === 'missing') return <PersonMissing />;
  if (view === 'error') return <PageError message={t('error.generic')} />;

  return (
    <div className="container person-page">
      <HeaderBackLink />
      {view === null ? <PersonHeaderSkeleton /> : <PersonHeader view={view} list="articole" actions={<NewPostButton view={view} />} />}

      {current === null ? (
        <GridSkeleton />
      ) : current === 'private' ? (
        <div className="empty-state card">
          <Lock size={34} className="empty-icon" aria-hidden="true" />
          <p>{t('people.private')}</p>
        </div>
      ) : typeof current === 'string' ? (
        <p className="form-error">{current}</p>
      ) : current.manage ? (
        <ManageList posts={current.posts} setPosts={setPosts} everyone={current.everyone} />
      ) : current.posts.length === 0 ? (
        <div className="empty-state card">
          <FileText size={34} className="empty-icon" aria-hidden="true" />
          <p>{t('people.emptyPublic')}</p>
        </div>
      ) : (
        <div className="post-grid post-grid-3">
          {current.posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}

/** /admin/articole: every post, to manage, with "New post" (in an author's name, picked in the editor). */
export function AdminArticlesPage() {
  const { t, errorMessage } = useI18n();
  const { user } = useAuth();
  const [list, setList] = useState<ArticleList | string | null>(null);

  useEffect(() => {
    api<ArticleList>(`/u/${encodeURIComponent(user!.username)}/articole`)
      .then(setList)
      .catch((err) => setList(errorMessage(err)));
  }, []);

  const setPosts: Dispatch<SetStateAction<PostSummary[]>> = (change) =>
    setList((state) => (state && typeof state === 'object' ? { ...state, posts: typeof change === 'function' ? change(state.posts) : change } : state));

  return (
    <div className="container person-page">
      <HeaderBackLink to="/admin" label={t('admin.back')} />
      <section className="page-hero">
        <div className="page-hero-text">
          <h1>{t('nav.manage')}</h1>
          <p className="muted">{t('manage.subtitle')}</p>
        </div>
        <Link to={newArticlePath(user!.username)} className="btn btn-primary">
          <Plus size={17} /> {t('manage.new')}
        </Link>
      </section>
      {list === null ? <GridSkeleton /> : typeof list === 'string' ? <p className="form-error">{list}</p> : <ManageList posts={list.posts} setPosts={setPosts} everyone />}
    </div>
  );
}

/** "New post", for an author's own list, and for administrators (on an author's list it's in that author's name). */
function NewPostButton({ view }: { view: PersonView }) {
  const { t } = useI18n();
  const { person, me, manage } = view;
  if (!manage || !(person.role === 'author' || (me && person.role === 'owner'))) return null;
  return (
    <Link to={newArticlePath(person.username)} className="btn btn-primary btn-sm">
      <Plus size={16} /> {t('manage.new')}
    </Link>
  );
}

/** Their articles to manage: by status, with links to edit, view and delete. Administrators keep seeing deleted ones. */
function ManageList({ posts, setPosts, everyone }: { posts: PostSummary[]; setPosts: Dispatch<SetStateAction<PostSummary[]>>; everyone: boolean }) {
  const { t, errorMessage, formatDate, formatDateTime } = useI18n();
  const { isOwner } = useAuth();
  const { reload: reloadCategories } = useCategories();
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');

  async function remove(post: PostSummary) {
    if (!window.confirm(t('editor.confirmDelete'))) return;
    try {
      await api(`/u/${post.author.username}/articole/${post.id}`, { method: 'DELETE' });
      // Administrators keep seeing it, on the "Deleted" tab.
      setPosts((current) => (isOwner ? current.map((p) => (p.id === post.id ? { ...p, deleted: true } : p)) : current.filter((p) => p.id !== post.id)));
      void reloadCategories();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const matches = (post: PostSummary, value: Filter) =>
    value === 'deleted' ? post.deleted : !post.deleted && (value === 'all' || post.status === value);
  const count = (value: Filter) => posts.filter((p) => matches(p, value)).length;
  const visible = posts.filter((p) => matches(p, filter));
  const filters = FILTERS.filter((value) => value !== 'deleted' || count('deleted') > 0);

  return (
    <>
      <div className="tabs" role="tablist">
        {filters.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            className={`tab${filter === value ? ' is-selected' : ''}`}
            onClick={() => setFilter(value)}
          >
            {value === 'all' ? t('manage.filter.all') : value === 'deleted' ? t('manage.filter.deleted') : t(`post.status.${value}`)}
            <span className="count-pill">{count(value)}</span>
          </button>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}
      {visible.length === 0 ? (
        <div className="empty-state card">
          <p>{t('manage.empty')}</p>
        </div>
      ) : (
        <ul className="manage-list">
          {visible.map((post) => (
            <li key={post.id} className={`manage-item card${post.deleted ? ' is-deleted' : ''}`}>
              <div className="manage-thumb">
                {post.bannerUrl ? <img src={post.bannerUrl} alt="" loading="lazy" /> : <span aria-hidden="true">{post.category?.icon || '✦'}</span>}
              </div>
              <div className="manage-main">
                <div className="manage-tags">
                  {post.deleted && <span className="badge badge-deleted">{t('post.deleted')}</span>}
                  <span className={`badge badge-status-${post.status}`}>{t(`post.status.${post.status}`)}</span>
                  {post.category && <span className="chip">{post.category.name}</span>}
                  {everyone && (
                    <Link to={articlesPath(post.author.username)} className="muted small">
                      {post.author.name}
                    </Link>
                  )}
                </div>
                <Link to={post.deleted ? `/posts/${post.slug}` : articlePath(post.author.username, post.id)} className="manage-title">
                  {post.title}
                </Link>
                <span className="muted small">
                  {post.status === 'scheduled' && post.publishedAt ? (
                    <>
                      <CalendarClock size={13} /> {t('post.scheduledFor', { date: formatDateTime(post.publishedAt) })}
                    </>
                  ) : post.status === 'published' && post.publishedAt ? (
                    formatDate(post.publishedAt)
                  ) : (
                    t('manage.updated', { date: formatDateTime(post.updatedAt) })
                  )}
                  {post.status === 'published' && (
                    <>
                      {' · '}
                      <Heart size={13} /> {post.likeCount} · <MessageCircle size={13} /> {post.commentCount}
                    </>
                  )}
                </span>
              </div>
              <div className="manage-actions">
                <Link to={`/posts/${post.slug}`} className="icon-btn" title={t('editor.view')} aria-label={t('editor.view')}>
                  <ExternalLink size={17} />
                </Link>
                {!post.deleted && (
                  <>
                    <Link to={articlePath(post.author.username, post.id)} className="icon-btn" title={t('post.edit')} aria-label={t('post.edit')}>
                      <SquarePen size={17} />
                    </Link>
                    <button type="button" className="icon-btn icon-btn-danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => remove(post)}>
                      <Trash2 size={17} />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Nobody has this username. */
export function PersonMissing() {
  const { t } = useI18n();
  return (
    <div className="container">
      <HeaderBackLink />
      <div className="empty-state card">
        <span className="empty-glyph" aria-hidden="true">☾</span>
        <h1>{t('page.notFound')}</h1>
        <p className="muted">{t('people.notFound')}</p>
        <Link to="/" className="btn btn-secondary">
          {t('post.backHome')}
        </Link>
      </div>
    </div>
  );
}

export function PageError({ message }: { message: string }) {
  return (
    <div className="container">
      <HeaderBackLink />
      <p className="form-error">{message}</p>
    </div>
  );
}

export function PersonHeaderSkeleton() {
  return (
    <section className="card person-head is-loading" aria-hidden="true">
      <span className="skeleton person-head-avatar" />
      <div className="person-head-text">
        <span className="skeleton skeleton-line" style={{ width: '40%', height: 28 }} />
        <span className="skeleton skeleton-line" style={{ width: '22%' }} />
      </div>
    </section>
  );
}

export function GridSkeleton() {
  return (
    <div className="post-grid post-grid-3">
      {Array.from({ length: 3 }, (_, index) => (
        <PostCardSkeleton key={index} />
      ))}
    </div>
  );
}
