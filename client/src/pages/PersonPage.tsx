import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { BookOpen, Feather, Lock } from 'lucide-react';
import { BookCard } from '@/components/Books';
import { EmptyState } from '@/components/EmptyState';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { PersonHeader } from '@/components/PersonHeader';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { usePerson } from '@/lib/people';
import type { PersonList } from '@/lib/people';
import type { Book, PostSummary } from '@/lib/types';
import { GridSkeleton, PageError, PersonHeaderSkeleton, PersonMissing } from '@/pages/ArticlesPage';
import { SavedGrid, useMyBookmarks } from '@/pages/SavedPage';

type Loaded = { posts: PostSummary[] } | { books: Book[] } | 'private' | 'missing' | string;

/**
 * A person's public list (/{username}/jurnal, /carti, /salvate): their published articles, their published books,
 * the posts they saved; each when they made it public (Settings), or to them (as others will see it, with whether
 * it's public). Not theirs to have, or private: says so.
 */
export function PersonPage({ list }: { list: PersonList }) {
  const { username = '' } = useParams();
  const { t, errorMessage } = useI18n();
  const view = usePerson(username);
  const own = view !== null && typeof view === 'object' && view.me;
  const mine = useMyBookmarks(list === 'salvate' && own);
  const [loaded, setLoaded] = useState<{ key: string; value: Loaded } | null>(null);
  const key = `${username}|${list}`;

  // From the server (their own saved posts follow what they save and unsave, as they do it).
  useEffect(() => {
    if (view === null || view === 'missing' || view === 'error' || (list === 'salvate' && view.me)) return;
    let cancelled = false;
    const done = (value: Loaded) => !cancelled && setLoaded({ key, value });
    const path = list === 'jurnal' ? 'articole' : list === 'carti' ? 'carti' : 'articole-salvate';
    api<{ posts?: PostSummary[]; books?: Book[]; manage?: boolean }>(`/u/${encodeURIComponent(username)}/${path}`)
      .then((data) => {
        // Their own (they're served everything, to manage it): what the others see.
        if (list === 'carti') done({ books: (data.books ?? []).filter((book) => !data.manage || (book.published && book.chapters > 0)) });
        else done({ posts: (data.posts ?? []).filter((post) => !data.manage || post.status === 'published') });
      })
      .catch((err) => {
        const code = err instanceof ApiError ? err.code : '';
        done(code === 'private' || code === 'forbidden' ? 'private' : code === 'not_found' ? 'missing' : errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [key, view === null || typeof view !== 'object' ? view : view.me]);

  if (view === 'missing' || loaded?.value === 'missing') return <PersonMissing />;
  if (view === 'error') return <PageError message={t('error.generic')} />;

  const value: Loaded | null = list === 'salvate' && own ? { posts: mine.saved } : loaded?.key === key ? loaded.value : null;
  const loading = list === 'salvate' && own ? mine.loading : value === null;

  return (
    <div className="container person-page">
      <HeaderBackLink />
      {view === null ? <PersonHeaderSkeleton /> : <PersonHeader view={view} list={list} />}
      {value === 'private' ? (
        <EmptyState icon={Lock} title={t('people.private')} text={t('people.privateText')} />
      ) : typeof value === 'string' ? (
        <p className="form-error">{value}</p>
      ) : list === 'carti' ? (
        loading || !value || !('books' in value) ? (
          <GridSkeleton />
        ) : value.books.length === 0 ? (
          <EmptyState icon={BookOpen} title={t('people.emptyBooks')} text={t('people.emptyBooksText')} />
        ) : (
          <div className="books-grid">
            {value.books.map((book) => (
              <BookCard key={book.id} book={book} showSubject />
            ))}
          </div>
        )
      ) : list === 'jurnal' && value && 'posts' in value && value.posts.length === 0 && !loading ? (
        <EmptyState icon={Feather} title={t('people.emptyPublic')} text={t('people.emptyPublicText')} />
      ) : (
        <SavedGrid
          posts={value && 'posts' in value ? value.posts : []}
          loading={loading}
          error={list === 'salvate' && own ? mine.error : ''}
          empty={t(own ? 'saved.empty' : 'people.emptySaved')}
        />
      )}
    </div>
  );
}
