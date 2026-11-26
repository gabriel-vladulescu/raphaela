import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowRight, BookOpen, CalendarClock, Check, Clock, Compass, Headphones, Library, Lock, Pencil, Play, Plus, SearchX, Share2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { BookCard, BookStatus, bookColor, CoverOf, JourneyCard, ProgressRing, StreakWeek, SubjectTile, TimelineEntry } from '@/components/Books';
import { Dock } from '@/components/Dock';
import { EmptyState } from '@/components/EmptyState';
import { ShareSheet } from '@/components/ShareSheet';
import { site } from '@/config';
import { useAuth } from '@/context/auth';
import { api, ApiError } from '@/lib/api';
import { bookEditorPath, chapterPath, journalPath, newBookPath, roman, subjectPath } from '@/lib/books';
import { useI18n } from '@/lib/i18n';
import { FINISHED_AT, guestProgressOf, useReadingSummary } from '@/lib/reading';
import type { Book, Chapter, PostSummary, Subject } from '@/lib/types';
import { NARROW, useMediaQuery } from '@/lib/useMediaQuery';
import { NotFoundPage } from '@/pages/StatusPages';

/** The page's title in the browser tab, while it's open. */
function useTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · ${site.name}`;
    return () => {
      document.title = site.name;
    };
  }, [title]);
}

function PageHead({ label, title, intro }: { label: string; title: string; intro?: string }) {
  return (
    <header className="books-head">
      <p className="label">{label}</p>
      <h1>{title}</h1>
      {intro && <p className="books-intro">{intro}</p>}
    </header>
  );
}

// ---------- The library: /carti ----------

type Status = 'all' | 'live' | 'done';

export function LibraryPage() {
  const { t, errorMessage } = useI18n();
  const { canWrite } = useAuth();
  const narrow = useMediaQuery(NARROW);
  const reading = useReadingSummary();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState('');
  const [status, setStatus] = useState<Status>('all');
  useTitle(t('nav.books'));

  useEffect(() => {
    api<{ books: Book[] }>('/books')
      .then((data) => setBooks(data.books))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const subjects = useMemo(() => {
    const seen = new Map<string, NonNullable<Book['subject']>>();
    for (const book of books ?? []) if (book.subject) seen.set(book.subject.slug, book.subject);
    return [...seen.values()];
  }, [books]);

  const shown = (books ?? []).filter(
    (book) => (!subject || book.subject?.slug === subject) && (status === 'all' || (status === 'done' ? book.complete : !book.complete)),
  );
  // The book with the newest chapter, up top.
  const featured = books?.[0];

  return (
    <div className="container books-page">
      <PageHead label={t('books.libraryLabel')} title={t('books.libraryTitle')} intro={t('books.libraryIntro')} />

      {featured && <FeaturedBook book={featured} />}

      {error && <p className="form-error">{error}</p>}

      {books && books.length > 0 && (
        <div className="books-filters">
          <div className="chip-row" role="group" aria-label={t('books.bySubject')}>
            <button type="button" className={`filter-pill${subject ? '' : ' is-on'}`} onClick={() => setSubject('')}>
              {t('books.all')}
            </button>
            {subjects.map((s) => (
              <button key={s.slug} type="button" className={`filter-pill${subject === s.slug ? ' is-on' : ''}`} onClick={() => setSubject(s.slug)}>
                {s.icon && <span aria-hidden="true">{s.icon}</span>} {s.name}
              </button>
            ))}
          </div>
          <div className="seg-pills" role="group" aria-label={t('books.byStatus')}>
            {(['all', 'live', 'done'] as Status[]).map((value) => (
              <button key={value} type="button" className={status === value ? 'is-on' : ''} onClick={() => setStatus(value)}>
                {t(`books.status.${value}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {!books && !error ? (
        <div className="books-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton book-skeleton" />
          ))}
        </div>
      ) : shown.length === 0 && books?.length ? (
        // Books, but none with this subject or state.
        <EmptyState icon={SearchX} title={t('empty.filtered.title')} text={t('empty.filtered.books')}>
          <button
            type="button"
            className="btn btn-soft"
            onClick={() => {
              setSubject('');
              setStatus('all');
            }}
          >
            {t('empty.filtered.clear')}
          </button>
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon={Library} title={t('empty.books.title')} text={t('empty.books.text')}>
          {canWrite ? (
            <Link to={newBookPath()} className="btn btn-warm">
              <Plus size={16} /> {t('empty.books.start')}
            </Link>
          ) : (
            <Link to={journalPath()} className="btn btn-soft">
              {t('empty.books.toJournal')}
            </Link>
          )}
        </EmptyState>
      ) : (
        <div className="books-grid">
          {shown.map((book) => (
            <BookCard key={book.id} book={book} showSubject />
          ))}
        </div>
      )}

      {narrow && <Dock reading={reading} />}
    </div>
  );
}

/** The book with the newest chapter, large: the cover, what it's about, and where to start. */
function FeaturedBook({ book }: { book: Book }) {
  const { t, formatDate } = useI18n();
  const total = Math.max(book.planned ?? 0, book.chapters);
  return (
    <section className="featured-book glass" style={{ '--c': bookColor(book) } as CSSProperties}>
      <Link to={`/carti/${book.slug}`} className="featured-cover">
        <CoverOf book={book} label />
      </Link>
      <div className="featured-text">
        <p className="label">{t('books.featured')}</p>
        <h2>
          <Link to={`/carti/${book.slug}`}>{book.title}</Link>
        </h2>
        <p className="featured-by">
          {t('books.by', { name: book.author.name })}
          {book.subject ? ` · ${book.subject.name}` : ''}
        </p>
        {book.description && <p className="featured-desc">{book.description}</p>}
        <div className="segments" aria-label={t('books.chaptersOut', { n: book.chapters, total })}>
          {Array.from({ length: total }, (_, i) => (
            <i key={i} className={i < book.chapters ? 'is-on' : ''} />
          ))}
        </div>
        <p className="featured-meta">
          <BookStatus book={book} />
          {book.nextChapterAt && (
            <span className="muted">
              <CalendarClock size={15} /> {t('books.nextOn', { date: formatDate(book.nextChapterAt) })}
            </span>
          )}
        </p>
        {book.firstChapter && (
          <div className="featured-btns">
            <Link to={`/carti/${book.slug}`} className="btn btn-warm">
              <BookOpen size={17} /> {t('books.open')}
            </Link>
            <Link to={chapterPath(book.slug, book.firstChapter)} className="btn btn-soft">
              <Play size={15} fill="currentColor" /> {t('books.startReading')}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- A book: /carti/:slug ----------

interface BookData {
  book: Book;
  contents: Chapter[];
  progress: Record<number, number>;
  canEdit: boolean;
  related: Book[];
}

export function BookPage() {
  const { slug = '' } = useParams();
  const { t, formatDate, formatShortDate, errorMessage } = useI18n();
  const { user } = useAuth();
  const narrow = useMediaQuery(NARROW);
  const reading = useReadingSummary();
  const [data, setData] = useState<BookData | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  useTitle(data?.book.title ?? null);

  useEffect(() => {
    setData(null);
    setMissing(false);
    api<BookData>(`/books/${encodeURIComponent(slug)}`)
      .then((loaded) => {
        // A guest's progress is in their browser.
        if (!user) loaded.progress = guestProgressOf(loaded.contents.map((chapter) => chapter.id));
        setData(loaded);
      })
      .catch((err) => (err instanceof ApiError && err.status === 404 ? setMissing(true) : setError(errorMessage(err))));
  }, [slug, user?.id]);

  if (missing) return <NotFoundPage />;
  if (!data) {
    return (
      <div className="container book-page">
        {error ? <p className="form-error">{error}</p> : <div className="skeleton book-hero-skeleton" />}
      </div>
    );
  }

  const { book, contents, progress } = data;
  const readable = contents.filter((chapter) => chapter.slug);
  const done = (chapter: Chapter) => (progress[chapter.id] ?? 0) >= FINISHED_AT;
  const read = readable.filter(done).length;
  // Where to go on: the first one started and not finished, else the first not read.
  const next = readable.find((chapter) => (progress[chapter.id] ?? 0) > 0 && !done(chapter)) ?? readable.find((chapter) => !done(chapter));
  const started = readable.some((chapter) => (progress[chapter.id] ?? 0) > 0);
  const total = Math.max(book.planned ?? 0, contents.filter((c) => c.state !== 'draft').length);
  const upcoming = contents.filter((chapter) => chapter.state === 'scheduled');

  return (
    <div className="container book-page">
      {/* Only its author and administrators see an unpublished book. */}
      {!book.published && <p className="notice book-hidden-note">{t('books.unpublishedNote')}</p>}
      <section className="book-hero glass" style={{ '--c': bookColor(book) } as CSSProperties}>
        <div className="book-hero-cover">
          <CoverOf book={book} label />
        </div>
        <div className="book-hero-text">
          {book.subject && (
            <Link to={subjectPath(book.subject.slug)} className="book-chip">
              {book.subject.icon && <span aria-hidden="true">{book.subject.icon}</span>} {book.subject.name}
            </Link>
          )}
          <h1>{book.title}</h1>
          <Link to={`/${book.author.username}`} className="book-author">
            <Avatar name={book.author.name} picture={book.author.picture} size={30} />
            <span>{book.author.name}</span>
          </Link>
          {book.description && <p className="book-desc">{book.description}</p>}
          <ul className="book-facts">
            <li>
              <BookOpen size={16} /> {book.planned ? t('books.chaptersOut', { n: book.chapters, total: book.planned }) : t('books.chaptersN', { n: book.chapters })}
            </li>
            <li>
              <Clock size={16} /> {t('books.totalMinutes', { n: book.minutes })}
            </li>
            <li>
              <BookStatus book={book} />
            </li>
          </ul>
          {readable.length > 0 && (
            <div className="book-progress">
              <div className="segments" aria-hidden="true">
                {Array.from({ length: total }, (_, i) => {
                  const chapter = contents.filter((c) => c.state !== 'draft')[i];
                  return <i key={i} className={chapter && done(chapter) ? 'is-on' : chapter?.id === next?.id && started ? 'is-now' : ''} />;
                })}
              </div>
              <span className="muted">{read > 0 ? t('books.readOf', { n: read, total: readable.length }) : t('books.notStarted')}</span>
            </div>
          )}
          <div className="book-btns">
            {next?.slug && (
              <Link to={chapterPath(book.slug, next.slug)} className="btn btn-warm">
                <Play size={15} fill="currentColor" /> {started ? t('books.continueAt', { n: next.no }) : t('books.startReading')}
              </Link>
            )}
            {next?.slug && (
              <Link to={`${chapterPath(book.slug, next.slug)}?asculta=1`} className="btn btn-soft">
                <Headphones size={17} /> {t('today.listen')}
              </Link>
            )}
            <button type="button" className="btn btn-soft btn-icon" aria-label={t('share.title')} title={t('share.title')} onClick={() => setSharing(true)}>
              <Share2 size={17} />
            </button>
            {data.canEdit && (
              <Link to={bookEditorPath(book.id)} className="btn btn-soft">
                <Pencil size={16} /> {t('books.edit')}
              </Link>
            )}
          </div>
        </div>
      </section>

      <div className="book-columns">
        <section className="contents glass" aria-labelledby="contents-title">
          <div className="contents-head">
            <h2 id="contents-title">{t('books.contents')}</h2>
            {upcoming[0]?.publishedAt && (
              <span className="book-chip is-live">
                <CalendarClock size={14} /> {t('books.nextOn', { date: formatDate(upcoming[0].publishedAt) })}
              </span>
            )}
          </div>
          <ol className="book-toc">
            {contents.map((chapter) => {
              const value = progress[chapter.id] ?? 0;
              const isDone = value >= FINISHED_AT;
              const body = (
                <>
                  <span className="toc-no">{roman(chapter.no)}</span>
                  <span className="toc-text">
                    <span className="toc-title">{chapter.title}</span>
                    {chapter.state === 'published' && chapter.excerpt && <span className="toc-excerpt">{chapter.excerpt}</span>}
                    <span className="toc-meta">
                      {chapter.state === 'scheduled' && chapter.publishedAt
                        ? t('books.comesOn', { date: formatShortDate(chapter.publishedAt) })
                        : chapter.state === 'draft'
                          ? t('post.status.draft')
                          : `${t('books.minutes', { n: chapter.minutes })}${chapter.publishedAt ? ` · ${formatShortDate(chapter.publishedAt)}` : ''}`}
                    </span>
                  </span>
                  <span className="toc-state" aria-hidden="true">
                    {chapter.slug === null ? (
                      <Lock size={16} />
                    ) : isDone ? (
                      <span className="toc-done">
                        <Check size={15} strokeWidth={2.6} />
                      </span>
                    ) : value > 0 ? (
                      <ProgressRing value={value} size={30} thickness={4} />
                    ) : (
                      <ArrowRight size={17} />
                    )}
                  </span>
                </>
              );
              const className = `toc-item is-${chapter.state}${isDone ? ' is-read' : ''}${chapter.id === next?.id ? ' is-next' : ''}`;
              return (
                <li key={chapter.id}>
                  {chapter.slug ? (
                    <Link to={chapterPath(book.slug, chapter.slug)} className={className}>
                      {body}
                    </Link>
                  ) : (
                    <div className={className}>{body}</div>
                  )}
                </li>
              );
            })}
            {book.planned &&
              book.planned > contents.length &&
              Array.from({ length: book.planned - contents.length }, (_, i) => (
                <li key={`planned-${i}`}>
                  <div className="toc-item is-planned">
                    <span className="toc-no">{roman(contents.length + i + 1)}</span>
                    <span className="toc-text">
                      <span className="toc-title muted">{t('books.planned')}</span>
                    </span>
                  </div>
                </li>
              ))}
          </ol>
        </section>

        {data.related.length > 0 && (
          <aside className="book-related">
            <h2>{t('books.related')}</h2>
            <div className="related-list">
              {data.related.map((other) => (
                <BookCard key={other.id} book={other} />
              ))}
            </div>
          </aside>
        )}
      </div>

      {sharing && (
        <ShareSheet
          item={{
            url: `${window.location.origin}/carti/${book.slug}`,
            title: book.title,
            text: book.description || book.title,
            image: `${window.location.origin}/api/og/site.jpg`,
            heading: t('books.shareHeading'),
          }}
          onClose={() => setSharing(false)}
        />
      )}
      {narrow && <Dock reading={reading} />}
    </div>
  );
}

// ---------- Subjects: /subiecte, /subiecte/:slug ----------

export function SubjectsPage() {
  const { t, errorMessage } = useI18n();
  const { isOwner } = useAuth();
  const narrow = useMediaQuery(NARROW);
  const reading = useReadingSummary();
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [error, setError] = useState('');
  useTitle(t('nav.subjects'));

  useEffect(() => {
    api<{ subjects: Subject[] }>('/subjects')
      .then((data) => setSubjects(data.subjects))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <div className="container books-page">
      <PageHead label={t('nav.subjects')} title={t('books.subjectsTitle')} intro={t('books.subjectsIntro')} />
      {error && <p className="form-error">{error}</p>}
      {subjects && subjects.length === 0 ? (
        <EmptyState icon={Compass} title={t('empty.subjects.title')} text={t('empty.subjects.text')}>
          {isOwner && (
            <Link to="/admin/categorii" className="btn btn-soft">
              {t('empty.subjects.manage')}
            </Link>
          )}
        </EmptyState>
      ) : (
        <div className="subjects is-page">
          {subjects
            ? subjects.map((subject, index) => <SubjectTile key={subject.id} subject={subject} index={index} />)
            : Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton subject-skeleton" />)}
        </div>
      )}
      {narrow && <Dock reading={reading} />}
    </div>
  );
}

interface SubjectData {
  subject: { id: number; name: string; slug: string; icon: string | null; description: string | null; articles: number };
  children: { id: number; name: string; slug: string; icon: string | null }[];
  books: Book[];
}

export function SubjectPage() {
  const { slug = '' } = useParams();
  const { t, errorMessage } = useI18n();
  const narrow = useMediaQuery(NARROW);
  const reading = useReadingSummary();
  const [data, setData] = useState<SubjectData | null>(null);
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  useTitle(data?.subject.name ?? null);

  useEffect(() => {
    setData(null);
    setMissing(false);
    api<SubjectData>(`/subjects/${encodeURIComponent(slug)}`)
      .then(setData)
      .catch((err) => (err instanceof ApiError && err.status === 404 ? setMissing(true) : setError(errorMessage(err))));
    api<{ posts: PostSummary[] }>(`/posts?category=${encodeURIComponent(slug)}&limit=6`)
      .then((loaded) => setPosts(loaded.posts))
      .catch(() => setPosts([]));
  }, [slug]);

  if (missing) return <NotFoundPage />;

  return (
    <div className="container books-page">
      {data ? (
        <header className="books-head subject-head">
          <span className="subject-icon is-big" aria-hidden="true">
            {data.subject.icon || '✦'}
          </span>
          <div>
            <p className="label">{t('nav.subjects')}</p>
            <h1>{data.subject.name}</h1>
            {data.subject.description && <p className="books-intro">{data.subject.description}</p>}
          </div>
        </header>
      ) : (
        <div className="skeleton books-head-skeleton" />
      )}
      {error && <p className="form-error">{error}</p>}

      {data && data.children.length > 0 && (
        <div className="chip-row subject-children">
          {data.children.map((child) => (
            <Link key={child.id} to={subjectPath(child.slug)} className="filter-pill">
              {child.icon && <span aria-hidden="true">{child.icon}</span>} {child.name}
            </Link>
          ))}
        </div>
      )}

      {data && data.books.length > 0 && (
        <section className="block">
          <div className="block-head">
            <h2>{t('nav.books')}</h2>
          </div>
          <div className="books-grid">
            {data.books.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        </section>
      )}

      {posts.length > 0 && (
        <section className="block">
          <div className="block-head">
            <h2>{t('today.journal')}</h2>
            <Link to={journalPath(slug)}>
              {t('books.allArticles', { n: data?.subject.articles ?? posts.length })} <ArrowRight size={16} />
            </Link>
          </div>
          <ol className="timeline">
            {posts.map((post) => (
              <TimelineEntry key={post.id} post={post} />
            ))}
          </ol>
        </section>
      )}

      {data && data.books.length === 0 && posts.length === 0 && (
        <div className="empty-state card">
          <span className="empty-glyph" aria-hidden="true">
            ✧
          </span>
          <p>{t('books.subjectEmpty')}</p>
        </div>
      )}
      {narrow && <Dock reading={reading} />}
    </div>
  );
}

// ---------- The reader's journeys: /drumuri ----------

export function JourneysPage() {
  const { t } = useI18n();
  const narrow = useMediaQuery(NARROW);
  const reading = useReadingSummary();
  useTitle(t('today.journeys'));
  const going = reading?.journeys.filter((journey) => journey.current) ?? [];
  const finished = reading?.journeys.filter((journey) => !journey.current) ?? [];

  return (
    <div className="container books-page">
      <PageHead label={t('nav.journeys')} title={t('today.journeys')} intro={t('books.journeysIntro')} />

      {reading?.streak && (
        <section className="streak-card glass">
          <ProgressRing value={Math.min(100, (reading.streak.week.filter((d) => d.read).length / 7) * 100)} size={84} thickness={7}>
            <b>{reading.streak.days}</b>
          </ProgressRing>
          <div>
            <h2>{reading.streak.days === 1 ? t('books.streakOne') : t('books.streakN', { n: reading.streak.days })}</h2>
            <p className="muted">{reading.streak.readToday ? t('books.streakToday') : t('books.streakInvite')}</p>
          </div>
          <StreakWeek streak={reading.streak} />
        </section>
      )}

      {!reading ? (
        <div className="journeys">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton journey-skeleton" />
          ))}
        </div>
      ) : reading.journeys.length === 0 ? (
        <div className="empty-state card">
          <span className="empty-glyph" aria-hidden="true">
            ✧
          </span>
          <p>{t('books.noJourneys')}</p>
          <Link to="/carti" className="btn btn-warm">
            <BookOpen size={17} /> {t('today.library')}
          </Link>
        </div>
      ) : (
        <>
          {going.length > 0 && (
            <section className="block">
              <div className="block-head">
                <h2>{t('books.going')}</h2>
              </div>
              <div className="journeys is-grid">
                {going.map((journey) => (
                  <JourneyCard key={journey.book.id} journey={journey} />
                ))}
              </div>
            </section>
          )}
          {finished.length > 0 && (
            <section className="block">
              <div className="block-head">
                <h2>{t('books.done')}</h2>
              </div>
              <div className="journeys is-grid">
                {finished.map((journey) => (
                  <JourneyCard key={journey.book.id} journey={journey} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {narrow && <Dock reading={reading} />}
    </div>
  );
}
