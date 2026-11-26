import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { CalendarClock, Eye, Heart, MessageCircle, Pencil, Trash2 } from 'lucide-react';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { ConfirmModal } from '@/components/Modal';
import { PostCardSkeleton } from '@/components/PostCard';
import { WritingDesk } from '@/components/WritingDesk';
import { useAuth } from '@/context/auth';
import { useCategories } from '@/context/categories';
import { api } from '@/lib/api';
import type { CoverDesign } from '@/lib/covers';
import { useI18n } from '@/lib/i18n';
import { articlePath, newArticlePath, postPath } from '@/lib/paths';
import type { PostStatus, PostSummary } from '@/lib/types';
import { NotFoundPage } from '@/pages/StatusPages';

type Filter = PostStatus | 'all';

const FILTERS: Filter[] = ['all', 'published', 'scheduled', 'draft'];

/** The journal desk's background: one cover, tilted in its corner (a picture, not a book). */
const DESK_COVER = { template: 'spirala', layout: 'clasic', ornament: 'feather', palette: 'adanc' } as CoverDesign;

/**
 * An old address, where it is now (the writer's own pages had their username in them, their editors were under it;
 * articles were "articole"; saved posts "articole-salvate"): `to` makes the new one from the old one's parts.
 */
export function OldPath({ to }: { to: (params: Readonly<Partial<Record<string, string>>>) => string }) {
  const params = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`${to(params)}${search}${hash}`} replace />;
}

/** An article's picture in the lists: its banner, else its category's sign on a soft ground. */
function ArticleThumb({ post }: { post: PostSummary }) {
  return (
    <span className="journal-thumb">
      {post.bannerUrl ? <img src={post.bannerUrl} alt="" loading="lazy" /> : <span aria-hidden="true">{post.category?.icon || '✦'}</span>}
    </span>
  );
}

/**
 * /jurnalul-meu: an author's own articles, to write and manage (drafts and scheduled ones too), as "My books"
 * shows their books: the desk on top (how many are out, scheduled, drafts; the one last worked on), then the
 * articles, by state. Nobody else's: readers find them in the journal, administrators in the admin panel.
 */
export function JournalPage() {
  const { t, plural, errorMessage, formatDate, formatDateTime, timeAgo } = useI18n();
  const { user, isOwner } = useAuth();
  const username = user?.username ?? '';
  const { reload: reloadCategories } = useCategories();
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [deleting, setDeleting] = useState<PostSummary | null>(null);
  const allowed = user?.role === 'author';

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setPosts(null);
    api<{ posts: PostSummary[] }>(`/u/${encodeURIComponent(username)}/articole`)
      .then((data) => !cancelled && setPosts(data.posts))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [username, allowed]);

  // Administrators have every post in the admin panel; nobody else may see an author's journal.
  if (isOwner) return <Navigate to="/admin/articole" replace />;
  if (!allowed) return <NotFoundPage />;

  /** Deletes one (asked first: `deleting`). */
  async function remove(post: PostSummary) {
    setDeleting(null);
    try {
      await api(`/u/${encodeURIComponent(username)}/articole/${post.id}`, { method: 'DELETE' });
      setPosts((current) => current?.filter((p) => p.id !== post.id) ?? current);
      void reloadCategories();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const count = (value: Filter) => (posts ?? []).filter((p) => value === 'all' || p.status === value).length;
  const shown = (posts ?? []).filter((p) => filter === 'all' || p.status === filter);
  const published = count('published');
  const scheduled = count('scheduled');
  const drafts = count('draft');
  const last = posts?.[0];
  const status = (post: PostSummary) => t(`post.status.${post.status}`);

  const line = !posts
    ? ''
    : posts.length === 0
      ? t('journal.mineIntro')
      : published
        ? t('journal.deskLine', { published: plural('journal.count', published) })
        : t('journal.deskNone');

  return (
    <div className="container books-page my-books">
      <HeaderBackLink />
      <WritingDesk
        title={t('journal.mineTitle')}
        line={line}
        stats={
          posts && posts.length > 0
            ? [
                { value: published, label: t(published === 1 ? 'journal.deskPublished' : 'journal.deskPublishedN') },
                { value: scheduled, label: t(scheduled === 1 ? 'journal.deskScheduled' : 'journal.deskScheduledN') },
                { value: drafts, label: t(drafts === 1 ? 'books.deskDraft' : 'books.deskDrafts') },
              ]
            : null
        }
        newTo={newArticlePath()}
        newLabel={t('manage.new')}
        cover={{ design: DESK_COVER, title: t('journal.coverTitle'), subject: t('journal.coverSubject'), author: user!.name }}
        last={
          last
            ? {
                thumb: <ArticleThumb post={last} />,
                thumbTo: articlePath(last.id),
                title: last.title || t('post.untitled'),
                meta: `${status(last).toLocaleLowerCase()} · ${timeAgo(last.updatedAt)}`,
                actions: (
                  <>
                    <Link to={articlePath(last.id)} className="btn btn-soft btn-sm">
                      <Pencil size={15} /> {t('journal.deskContinue')}
                    </Link>
                    <Link to={postPath(last)} className="btn btn-soft btn-sm">
                      <Eye size={15} /> {t('journal.view')}
                    </Link>
                  </>
                ),
              }
            : null
        }
      />

      {error && <p className="form-error">{error}</p>}

      {posts && posts.length > 0 && (
        <div className="books-filters journal-filters">
          <div className="chip-row" role="group" aria-label={t('journal.byState')}>
            {FILTERS.map((value) => (
              <button key={value} type="button" className={`filter-pill${filter === value ? ' is-on' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {value === 'all' ? t('manage.filter.all') : t(`journal.filter.${value}`)} <span className="filter-pill-count">{count(value)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {posts === null && !error ? (
        <div className="my-books-list">
          {Array.from({ length: 2 }, (_, index) => (
            <PostCardSkeleton key={index} />
          ))}
        </div>
      ) : (
        <div className="my-books-list">
          {shown.map((post) => (
            <article key={post.id} className="my-book glass">
              <div className="my-book-inner">
                <Link to={articlePath(post.id)} className="my-book-cover" tabIndex={-1} aria-label={post.title || t('post.untitled')}>
                  <ArticleThumb post={post} />
                </Link>
                <div className="my-book-text">
                  {/* Its state first, over the title (as the books'). */}
                  <span className="my-book-chips">
                    <span className={`book-chip journal-chip is-${post.status}`}>{status(post)}</span>
                    {post.category && <span className="book-chip">{post.category.name}</span>}
                  </span>
                  <h2>
                    <Link to={articlePath(post.id)}>{post.title || t('post.untitled')}</Link>
                  </h2>
                  <p className="muted journal-meta">
                    {post.status === 'scheduled' && post.publishedAt ? (
                      <>
                        <CalendarClock size={14} /> {t('post.scheduledFor', { date: formatDateTime(post.publishedAt) })}
                      </>
                    ) : post.status === 'published' && post.publishedAt ? (
                      <>
                        {formatDate(post.publishedAt)} · <Heart size={14} /> {post.likeCount} · <MessageCircle size={14} /> {post.commentCount}
                      </>
                    ) : (
                      t('manage.updated', { date: formatDateTime(post.updatedAt) })
                    )}
                  </p>
                </div>
                <div className="my-book-actions">
                  <Link to={postPath(post)} className="btn btn-soft btn-sm">
                    <Eye size={15} /> {t('journal.view')}
                  </Link>
                  <Link to={articlePath(post.id)} className="btn btn-soft btn-sm">
                    <Pencil size={15} /> {t('books.edit')}
                  </Link>
                  <button type="button" className="btn btn-soft btn-sm is-danger" onClick={() => setDeleting(post)}>
                    <Trash2 size={15} /> {t('common.delete')}
                  </button>
                </div>
              </div>
            </article>
          ))}
          {posts && posts.length > 0 && shown.length === 0 && <p className="muted journal-none">{t('manage.empty')}</p>}
        </div>
      )}

      {deleting && (
        <ConfirmModal
          title={t('editor.delete')}
          message={t('editor.confirmDelete')}
          confirmLabel={t('editor.delete')}
          danger
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
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
