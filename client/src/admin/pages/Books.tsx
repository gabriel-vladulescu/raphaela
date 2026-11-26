import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BellRing, BookOpen, Eye, EyeOff, ExternalLink, Heart, ListOrdered, Mail, MessageSquare, PenLine, RotateCcw, Trash2, Users } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import type { AdminBook, BookFilter, BookList } from '@/admin/types';
import { UserSelect } from '@/admin/UserSelect';
import { Badge, Card, ClearFilters, ConfirmDialog, Empty, ErrorNote, LoadMore, Loading, PageHead, SearchBox, Select, Tabs } from '@/admin/ui';
import { Avatar } from '@/components/Avatar';
import { BookCover } from '@/components/BookCover';
import { api, ApiError } from '@/lib/api';
import { bookEditorPath, bookPath } from '@/lib/books';
import type { CoverDesign } from '@/lib/covers';

const PAGE = 25;
const FILTERS: BookFilter[] = ['all', 'public', 'hidden', 'ongoing', 'complete', 'deleted'];
const SORTS = ['updated', 'new', 'title', 'views', 'followers'] as const;
type Sort = (typeof SORTS)[number];

/** What a book is on the site: public, hidden by its author (or an administrator), or without a chapter out yet. */
function stateOf(book: AdminBook): { key: string; tone: 'good' | 'neutral' | 'warn' | 'bad' } {
  if (book.deletedAt) return { key: 'deleted', tone: 'bad' };
  if (!book.published) return { key: 'hidden', tone: 'neutral' };
  if (book.chapters === 0) return { key: 'waiting', tone: 'warn' };
  return { key: 'public', tone: 'good' };
}

/**
 * Every book, its author's and its readers' numbers: on the site or hidden, finished or still being written, its
 * chapters (out, drafts, scheduled), views, likes, comments, readers, and who waits for the next chapter (by email,
 * on a device). Open it, edit it (the book's page), see its chapters (Posts), hide or show it, delete an empty one,
 * restore a deleted one.
 */
export function BooksPage() {
  const { t, formatNumber, formatShortDate, errorMessage } = useAdminI18n();
  const { refreshOverview } = useAdmin();
  const [params, setParams] = useSearchParams();
  const status = (FILTERS.find((f) => f === params.get('status')) ?? 'all') as BookFilter;
  const sort = (SORTS.find((s) => s === params.get('sort')) ?? 'updated') as Sort;
  const q = params.get('q') ?? '';
  const author = params.get('author') ?? '';
  const [data, setData] = useState<BookList | null>(null);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);
  const [deleting, setDeleting] = useState<AdminBook | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const query = useCallback(
    (offset: number) =>
      `/admin/books?status=${status}&sort=${sort}&offset=${offset}&limit=${PAGE}${q ? `&q=${encodeURIComponent(q)}` : ''}${author ? `&author=${author}` : ''}`,
    [status, sort, q, author],
  );
  const load = useCallback(() => {
    setError(false);
    api<BookList>(query(0))
      .then(setData)
      .catch(() => setError(true));
  }, [query]);
  useEffect(load, [load]);

  async function loadMore() {
    if (!data) return;
    setMore(true);
    try {
      const next = await api<BookList>(query(data.books.length));
      setData({ ...next, books: [...data.books, ...next.books.filter((b) => !data.books.some((o) => o.id === b.id))] });
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

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError('');
    try {
      await action();
      setDeleting(null);
      load();
      refreshOverview();
    } catch (err) {
      setActionError(err instanceof ApiError && err.code === 'book_not_empty' ? t('books.notEmpty') : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const filtered = Boolean(q || author);
  return (
    <>
      <PageHead title={t('nav.books')} subtitle={t('books.subtitle')} />
      <Card flush>
        <div className="adm-toolbar">
          <Tabs<BookFilter>
            label={t('books.filter')}
            value={status}
            onChange={(value) => set('status', value === 'all' ? '' : value)}
            items={FILTERS.map((value) => ({ value, label: t(`books.status.${value}` as AdminKey), count: data?.counts[value] }))}
          />
          <div className="adm-toolbar-row">
            <SearchBox value={q} onChange={(value) => set('q', value)} placeholder={t('books.search')} />
            <UserSelect
              label={t('books.author')}
              placeholder={t('posts.allAuthors')}
              clear={t('posts.allAuthors')}
              filter={{ role: 'writer' }}
              value={author ? Number(author) : null}
              onChange={(id) => set('author', id ? String(id) : '')}
            />
            <Select<Sort> label={t('books.sort')} value={sort} onChange={(value) => set('sort', value === 'updated' ? '' : value)} options={SORTS.map((s) => ({ value: s, label: t(`books.sort.${s}` as AdminKey) }))} />
          </div>
        </div>
        {actionError && !deleting && <p className="adm-form-error adm-pad">{actionError}</p>}

        {error ? (
          <ErrorNote message={t('common.loadFailed')} onRetry={load} />
        ) : !data ? (
          <Loading />
        ) : data.books.length === 0 ? (
          <div className="adm-pad">
            <Empty icon={BookOpen} title={t('books.none')} body={t('books.noneBody')} />
            {filtered && (
              <div className="adm-center">
                <ClearFilters onClick={() => setParams(new URLSearchParams())} />
              </div>
            )}
          </div>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table is-cards adm-books-table">
              <thead>
                <tr>
                  <th scope="col">{t('books.book')}</th>
                  <th scope="col">{t('books.author')}</th>
                  <th scope="col">{t('books.state')}</th>
                  <th scope="col">{t('books.chapters')}</th>
                  <th scope="col">{t('books.numbers')}</th>
                  <th scope="col">{t('books.waiting')}</th>
                  <th scope="col" className="is-actions">
                    <span className="adm-visually-hidden">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.books.map((book) => {
                  const state = stateOf(book);
                  return (
                    <tr key={book.id} className={book.deletedAt ? 'is-muted' : undefined}>
                      <th scope="row">
                        <div className="adm-book-cell">
                          <BookCover design={book.cover as CoverDesign} title={book.title} mini />
                          <div>
                            <span className="adm-cell-title">{book.title}</span>
                            <span className="adm-muted adm-small">
                              {book.subject?.name ?? t('books.noSubject')} · {t('books.updated', { date: formatShortDate(book.updatedAt) })}
                            </span>
                          </div>
                        </div>
                      </th>
                      <td data-label={t('books.author')}>
                        <Link to={`/admin/utilizatori?id=${book.author.id}`} className="adm-person">
                          <Avatar name={book.author.name} picture={book.author.picture} size={22} />
                          {book.author.name}
                        </Link>
                      </td>
                      <td data-label={t('books.state')}>
                        <span className="adm-badges">
                          <Badge tone={state.tone}>{t(`books.state.${state.key}` as AdminKey)}</Badge>
                          {!book.deletedAt && <Badge tone={book.complete ? 'accent' : 'info'}>{t(book.complete ? 'books.complete' : 'books.ongoing')}</Badge>}
                        </span>
                      </td>
                      <td data-label={t('books.chapters')}>
                        <span className="adm-small">
                          {t('books.chaptersOut', { n: book.chapters, all: book.allChapters })}
                          {book.planned ? ` · ${t('books.planned', { n: book.planned })}` : ''}
                        </span>
                        {(book.drafts > 0 || book.scheduled > 0) && (
                          <span className="adm-muted adm-small">{t('books.draftsScheduled', { drafts: book.drafts, scheduled: book.scheduled })}</span>
                        )}
                      </td>
                      <td data-label={t('books.numbers')}>
                        <span className="adm-numbers adm-small">
                          <span title={t('posts.views')}>
                            <Eye size={13} aria-hidden="true" /> {formatNumber(book.views)}
                          </span>
                          <span title={t('posts.likes')}>
                            <Heart size={13} aria-hidden="true" /> {formatNumber(book.likes)}
                          </span>
                          <span title={t('posts.comments')}>
                            <MessageSquare size={13} aria-hidden="true" /> {formatNumber(book.comments)}
                          </span>
                          <span title={t('books.readers')}>
                            <Users size={13} aria-hidden="true" /> {formatNumber(book.readers)}
                          </span>
                        </span>
                      </td>
                      <td data-label={t('books.waiting')}>
                        <span className="adm-numbers adm-small">
                          <span title={t('books.byEmail')}>
                            <Mail size={13} aria-hidden="true" /> {formatNumber(book.followers.email)}
                          </span>
                          <span title={t('books.onDevices')}>
                            <BellRing size={13} aria-hidden="true" /> {formatNumber(book.followers.devices)}
                          </span>
                        </span>
                      </td>
                      <td className="is-actions">
                        <div className="adm-row-actions">
                          {state.key === 'public' && (
                            <Link to={bookPath(book.slug)} className="adm-icon-btn" title={t('books.view')} aria-label={t('books.view')}>
                              <ExternalLink size={16} />
                            </Link>
                          )}
                          {!book.deletedAt && (
                            <>
                              <Link to={`/admin/articole?tip=capitole&carte=${book.id}`} className="adm-icon-btn" title={t('books.seeChapters')} aria-label={t('books.seeChapters')}>
                                <ListOrdered size={16} />
                              </Link>
                              <Link to={bookEditorPath(book.id)} className="adm-icon-btn" title={t('books.edit')} aria-label={t('books.edit')}>
                                <PenLine size={16} />
                              </Link>
                              <button
                                type="button"
                                className="adm-icon-btn"
                                title={t(book.published ? 'books.hide' : 'books.show')}
                                aria-label={t(book.published ? 'books.hide' : 'books.show')}
                                disabled={busy}
                                onClick={() => void run(() => api(`/admin/books/${book.id}/published`, { method: 'POST', body: { published: !book.published } }))}
                              >
                                {book.published ? <EyeOff size={16} /> : <Eye size={16} />}
                              </button>
                              <button
                                type="button"
                                className="adm-icon-btn is-danger"
                                title={book.allChapters > 0 ? t('books.notEmpty') : t('books.delete')}
                                aria-label={t('books.delete')}
                                disabled={book.allChapters > 0}
                                onClick={() => setDeleting(book)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                          {book.deletedAt && (
                            <button
                              type="button"
                              className="adm-icon-btn"
                              title={t('books.restore')}
                              aria-label={t('books.restore')}
                              disabled={busy}
                              onClick={() => void run(() => api(`/admin/books/${book.id}/restore`, { method: 'POST' }))}
                            >
                              <RotateCcw size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data?.hasMore && <LoadMore busy={more} onClick={() => void loadMore()} />}
      </Card>

      {deleting && (
        <ConfirmDialog
          title={t('books.delete')}
          body={t('books.deleteBody', { title: deleting.title })}
          confirmLabel={t('books.delete')}
          danger
          busy={busy}
          error={actionError}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void run(() => api(`/admin/books/${deleting.id}`, { method: 'DELETE' }))}
        />
      )}
    </>
  );
}
