import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ExternalLink, Eye, FileText, Heart, MessageSquare, PenLine, Pin, PinOff, RotateCcw, Trash2, X } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import type { AdminPost, PostFilter, PostList } from '@/admin/types';
import { UserSelect } from '@/admin/UserSelect';
import { Badge, Card, ClearFilters, ConfirmDialog, Empty, ErrorNote, LoadMore, Loading, PageHead, SearchBox, Select, Tabs } from '@/admin/ui';
import type { Tone } from '@/admin/ui';
import { Avatar } from '@/components/Avatar';
import { api } from '@/lib/api';
import { chapterEditorPath } from '@/lib/books';
import { articlePath, newArticlePath } from '@/lib/paths';

const PAGE = 25;
const FILTERS: PostFilter[] = ['all', 'featured', 'published', 'scheduled', 'draft', 'deleted'];
/** Articles (the journal), or the books' chapters: listed apart. */
const KINDS = ['post', 'chapter'] as const;
type Kind = (typeof KINDS)[number];
const SORTS = ['new', 'updated', 'views', 'likes', 'comments'] as const;
type Sort = (typeof SORTS)[number];
const STATUS_TONE: Record<AdminPost['status'], Tone> = { published: 'good', scheduled: 'info', draft: 'neutral', deleted: 'bad' };

/**
 * Every article, or every chapter of the books (?tip=capitole), with its numbers: filter, search, sort; open it, edit
 * it (the site's editor), pin an article to the top of the journal, delete or restore it.
 */
export function PostsPage() {
  const { t, formatNumber, formatShortDate } = useAdminI18n();
  const { refreshOverview } = useAdmin();
  const [params, setParams] = useSearchParams();
  const kind: Kind = params.get('tip') === 'capitole' ? 'chapter' : 'post';
  // Chapters aren't featured (that's the journal's top).
  const filters = kind === 'chapter' ? FILTERS.filter((f) => f !== 'featured') : FILTERS;
  const status = (filters.find((f) => f === params.get('status')) ?? 'all') as PostFilter;
  const sort = (SORTS.find((s) => s === params.get('sort')) ?? 'new') as Sort;
  const q = params.get('q') ?? '';
  const author = params.get('author') ?? '';
  /** One book's chapters (from Books: ?tip=capitole&carte={id}). */
  const book = kind === 'chapter' ? (params.get('carte') ?? '') : '';
  const [data, setData] = useState<PostList | null>(null);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);
  const [deleting, setDeleting] = useState<AdminPost | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const query = useCallback(
    (offset: number) =>
      `/admin/posts?kind=${kind}&status=${status}&sort=${sort}&offset=${offset}&limit=${PAGE}${q ? `&q=${encodeURIComponent(q)}` : ''}${author ? `&author=${author}` : ''}${book ? `&book=${book}` : ''}`,
    [kind, status, sort, q, author, book],
  );

  const load = useCallback(() => {
    setError(false);
    api<PostList>(query(0))
      .then(setData)
      .catch(() => setError(true));
  }, [query]);
  useEffect(load, [load]);

  async function loadMore() {
    if (!data) return;
    setMore(true);
    try {
      const next = await api<PostList>(query(data.posts.length));
      setData({ ...next, posts: [...data.posts, ...next.posts.filter((p) => !data.posts.some((o) => o.id === p.id))] });
    } finally {
      setMore(false);
    }
  }

  const set = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });

  async function feature(post: AdminPost) {
    setBusy(true);
    try {
      await api(`/admin/posts/${post.id}/feature`, { method: 'POST', body: { featured: !post.featured } });
      load();
    } finally {
      setBusy(false);
    }
  }

  async function act(post: AdminPost, action: 'delete' | 'restore') {
    setBusy(true);
    setActionError('');
    try {
      await api(action === 'delete' ? `/admin/posts/${post.id}` : `/admin/posts/${post.id}/restore`, { method: action === 'delete' ? 'DELETE' : 'POST' });
      setDeleting(null);
      load();
      refreshOverview();
    } catch {
      setActionError(t('common.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  const filtered = Boolean(q || author || book);
  const bookTitle = book ? data?.posts.find((post) => post.book)?.book?.title : null;
  return (
    <>
      <PageHead
        title={t('nav.posts')}
        subtitle={t('posts.subtitle')}
        actions={
          <Link to={newArticlePath()} className="adm-btn is-primary">
            <PenLine size={16} /> {t('posts.new')}
          </Link>
        }
      />
      <Card flush>
        <div className="adm-toolbar">
          <Tabs<PostFilter>
            label={t('posts.filter')}
            value={status}
            onChange={(value) => set('status', value === 'all' ? '' : value)}
            items={filters.map((value) => ({ value, label: t(`posts.status.${value}` as AdminKey), count: data?.counts[value] }))}
          />
          <div className="adm-toolbar-row">
            <Select<Kind>
              label={t('posts.kind')}
              value={kind}
              onChange={(value) =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  if (value === 'chapter') next.set('tip', 'capitole');
                  else next.delete('tip');
                  if (next.get('status') === 'featured') next.delete('status');
                  return next;
                })
              }
              options={KINDS.map((value) => ({ value, label: t(`posts.kind.${value}` as AdminKey) }))}
            />
            <SearchBox value={q} onChange={(value) => set('q', value)} placeholder={t('posts.search')} />
            <UserSelect
              label={t('posts.author')}
              placeholder={t('posts.allAuthors')}
              clear={t('posts.allAuthors')}
              filter={{ posts: true }}
              value={author ? Number(author) : null}
              onChange={(id) => set('author', id ? String(id) : '')}
            />
            <Select<Sort> label={t('posts.sort')} value={sort} onChange={(value) => set('sort', value === 'new' ? '' : value)} options={SORTS.map((s) => ({ value: s, label: t(`posts.sort.${s}` as AdminKey) }))} />
            {book && (
              <button type="button" className="adm-chip is-active" onClick={() => set('carte', '')} title={t('common.clearFilters')}>
                {t('posts.ofBook', { book: bookTitle ?? `#${book}` })} <X size={13} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {error ? (
          <ErrorNote message={t('common.loadFailed')} onRetry={load} />
        ) : !data ? (
          <Loading />
        ) : data.posts.length === 0 ? (
          <div className="adm-pad">
            <Empty icon={FileText} title={t('posts.none')} />
            {filtered && (
              <div className="adm-center">
                <ClearFilters onClick={() => setParams(new URLSearchParams(kind === 'chapter' ? 'tip=capitole' : ''))} />
              </div>
            )}
          </div>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table is-cards">
              <thead>
                <tr>
                  <th scope="col">{t('posts.title')}</th>
                  <th scope="col">{t('posts.author')}</th>
                  <th scope="col">{t('posts.state')}</th>
                  <th scope="col">{t('posts.date')}</th>
                  <th scope="col" className="is-num">
                    <Eye size={14} aria-label={t('posts.views')} />
                  </th>
                  <th scope="col" className="is-num">
                    <Heart size={14} aria-label={t('posts.likes')} />
                  </th>
                  <th scope="col" className="is-num">
                    <MessageSquare size={14} aria-label={t('posts.comments')} />
                  </th>
                  <th scope="col" className="is-actions">
                    <span className="adm-visually-hidden">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.posts.map((post) => (
                  <tr key={post.id} className={post.status === 'deleted' ? 'is-muted' : undefined}>
                    <th scope="row">
                      <div className="adm-post-cell">
                        {post.bannerUrl ? <img src={post.bannerUrl} alt="" loading="lazy" /> : <span className="adm-thumb-empty" aria-hidden="true" />}
                        <div>
                          <span className="adm-cell-title">
                            {post.featured && <Pin size={13} className="adm-pin" aria-label={t('posts.featured')} />}
                            {post.title || <span className="adm-muted">{t('posts.untitled')}</span>}
                          </span>
                          <span className="adm-muted adm-small">
                            {post.book ? t('posts.chapterOf', { n: post.book.chapter, book: post.book.title }) : (post.category ?? t('posts.noCategory'))}
                          </span>
                        </div>
                      </div>
                    </th>
                    <td data-label={t('posts.author')}>
                      <span className="adm-person">
                        <Avatar name={post.author.name} picture={post.author.picture} size={22} />
                        {post.author.name}
                        {post.author.deleted && <Badge tone="bad">{t('users.state.deleted')}</Badge>}
                      </span>
                    </td>
                    <td data-label={t('posts.state')}>
                      <Badge tone={STATUS_TONE[post.status]}>{t(`posts.status.${post.status}` as AdminKey)}</Badge>
                    </td>
                    <td data-label={t('posts.date')} className="adm-nowrap">
                      {formatShortDate(post.publishedAt ?? post.createdAt)}
                    </td>
                    <td className="is-num" data-label={t('posts.views')}>
                      {formatNumber(post.views)}
                    </td>
                    <td className="is-num" data-label={t('posts.likes')}>
                      {formatNumber(post.likes)}
                    </td>
                    <td className="is-num" data-label={t('posts.comments')}>
                      {formatNumber(post.comments)}
                    </td>
                    <td className="is-actions">
                      <div className="adm-row-actions">
                        {post.status === 'published' && (
                          <Link to={post.path} className="adm-icon-btn" title={t('posts.view')} aria-label={t('posts.view')}>
                            <ExternalLink size={16} />
                          </Link>
                        )}
                        {!post.book && (post.status === 'published' || post.featured) && (
                          <button
                            type="button"
                            className={`adm-icon-btn${post.featured ? ' is-on' : ''}`}
                            title={t(post.featured ? 'posts.unfeature' : 'posts.feature')}
                            aria-label={t(post.featured ? 'posts.unfeature' : 'posts.feature')}
                            aria-pressed={post.featured}
                            disabled={busy}
                            onClick={() => void feature(post)}
                          >
                            {post.featured ? <PinOff size={16} /> : <Pin size={16} />}
                          </button>
                        )}
                        {post.status !== 'deleted' && post.author.username && (
                          <Link
                            to={post.book ? chapterEditorPath(post.book.id, post.id) : articlePath(post.id)}
                            className="adm-icon-btn"
                            title={t('posts.edit')}
                            aria-label={t('posts.edit')}
                          >
                            <PenLine size={16} />
                          </Link>
                        )}
                        {post.status === 'deleted' ? (
                          <button type="button" className="adm-icon-btn" title={t('posts.restore')} aria-label={t('posts.restore')} disabled={busy} onClick={() => void act(post, 'restore')}>
                            <RotateCcw size={16} />
                          </button>
                        ) : (
                          <button type="button" className="adm-icon-btn is-danger" title={t('posts.delete')} aria-label={t('posts.delete')} onClick={() => setDeleting(post)}>
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.hasMore && <LoadMore busy={more} onClick={() => void loadMore()} />}
      </Card>

      {deleting && (
        <ConfirmDialog
          title={t('posts.delete')}
          body={t('posts.deleteBody', { title: deleting.title })}
          confirmLabel={t('posts.delete')}
          danger
          busy={busy}
          error={actionError}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void act(deleting, 'delete')}
        />
      )}
    </>
  );
}
