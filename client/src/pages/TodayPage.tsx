import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { ArrowRight, Bookmark, Compass, Feather, Headphones, Library, PenLine, Play, Plus, Share2 } from 'lucide-react';
import { BookCard, CoverOf, JourneyCard, ProgressRing, StreakWeek, SubjectTile, TimelineEntry } from '@/components/Books';
import { Dock } from '@/components/Dock';
import { EmptyState } from '@/components/EmptyState';
import { ScrollHint } from '@/components/ScrollHint';
import { site } from '@/config';
import { useAuth } from '@/context/auth';
import { useReactions } from '@/context/reactions';
import { api } from '@/lib/api';
import { bookPath, chapterPath, journalPath, newBookPath, roman } from '@/lib/books';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { moonOn } from '@/lib/moon';
import { newArticlePath } from '@/lib/paths';
import { localDay, useReadingSummary } from '@/lib/reading';
import { hideSplash } from '@/lib/splash';
import { showToast } from '@/lib/toast';
import type { Book, Chapter, Journey, PostSummary, Subject, Thought } from '@/lib/types';
import { NARROW, useMediaQuery } from '@/lib/useMediaQuery';

interface HomeData {
  thought: Thought | null;
  books: Book[];
  subjects: Subject[];
  journal: PostSummary[];
  latestChapter: { book: Book; chapter: Chapter } | null;
  /** The newest books as journeys not started yet: after the reader's own, up to three. */
  starts: Journey[];
}

/** Where the thought of the day comes from: a chapter (under its book), or a post. */
const thoughtPath = (thought: Thought) => (thought.book ? chapterPath(thought.book.slug, thought.post.slug) : `/posts/${thought.post.slug}`);

/** Morning, day, evening or night, by the reader's clock. */
function partOfDay(hour: number) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'day';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';
}

/** The Moon, drawn: lit from the right while it waxes, from the left while it wanes. */
function MoonIcon() {
  const moon = moonOn();
  const lit = moon.illumination / 100;
  // The shadow slides off as the Moon fills: over it at the new moon, gone at the full moon.
  const offset = Math.round(lit * 26) * (moon.waxing ? -1 : 1);
  return <span className="sky-moon" style={{ '--shadow': `${offset}px` } as CSSProperties} aria-hidden="true" />;
}

/**
 * The home page ("Today", variant 3 "Ritual"): a greeting by the time of day with the date and the Moon, the
 * thought of the day (a quote from the books), today's reading (where the reader is, with a ring, "continue" and
 * "listen", and the week's streak), their journeys through the books (theirs, then new ones to start: three at most),
 * the subjects, all the books, and the latest five articles as a timeline. A section with nothing in it says so
 * (EmptyState); the journeys go when there are no books. Phones get the dock at the bottom.
 */
export function TodayPage() {
  const { t, locale, errorMessage } = useI18n();
  const { user, isOwner, canWrite } = useAuth();
  const { isBookmarked, toggleBookmark } = useReactions();
  const [params] = useSearchParams();
  const narrow = useMediaQuery(NARROW);
  const reading = useReadingSummary();
  const [home, setHome] = useState<HomeData | null>(null);
  const [error, setError] = useState('');
  /** The rows that scroll sideways on phones (their titles say so: ScrollHint). */
  const journeysRow = useRef<HTMLDivElement>(null);
  const booksRow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api<HomeData>(`/home?today=${localDay()}`)
      .then((data) => !cancelled && setHome(data))
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(hideSplash);
    return () => {
      cancelled = true;
    };
  }, []);

  // Earlier addresses of the articles' list.
  if (params.get('q') || params.get('category')) return <Navigate to={`/jurnal?${params}`} replace />;

  const now = new Date();
  const part = partOfDay(now.getHours());
  const firstName = user?.name.split(/\s+/)[0];
  const moon = moonOn(now);
  const dateLine = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const current = reading?.current;
  const streak = reading?.streak;
  const latest = home?.latestChapter;

  // What the reader is invited to read now: where they are, or the newest chapter.
  const today = current
    ? { book: current.book, chapter: current.chapter, progress: current.chapter.progress, minutesLeft: current.chapter.minutesLeft, fresh: false }
    : latest
      ? { book: latest.book, chapter: latest.chapter, progress: 0, minutesLeft: latest.chapter.minutes, fresh: true }
      : null;
  const totalOf = (book: Book) => Math.max(book.planned ?? 0, book.chapters);

  let intro: string;
  if (current && streak && streak.days >= 2) intro = t('today.introStreak', { n: streak.days, no: current.chapter.no, book: current.book.title });
  else if (current) intro = t('today.introCurrent', { no: current.chapter.no, book: current.book.title });
  else intro = t('today.intro');

  async function shareThought(thought: Thought) {
    const url = `${window.location.origin}${thoughtPath(thought)}`;
    const text = `„${thought.text}” — ${thought.book?.title ?? thought.post.title}`;
    try {
      if (navigator.share) await navigator.share({ title: site.name, text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        showToast({ message: t('today.thoughtCopied') });
      }
    } catch {
      // closed the share menu
    }
  }

  // Three journeys: the books they started (the last one read first), then the newest ones, not started yet. Once
  // both are known, so they don't reorder as they come.
  const started = reading?.journeys ?? [];
  const journeys =
    reading && home ? [...started, ...home.starts.filter((start) => !started.some((journey) => journey.book.id === start.book.id))].slice(0, 3) : [];

  return (
    <div className="container today-page">
      <section className="today">
        <div className="hello">
          <p className="sky">
            <MoonIcon />
            <span>
              {dateLine.charAt(0).toUpperCase() + dateLine.slice(1)} · {t(`moon.${moon.phase}` as MessageKey)}, {moon.illumination}%
            </span>
          </p>
          <h1>
            {t(`today.hello.${part}` as MessageKey)}
            {firstName ? (
              <>
                , <b>{firstName}</b>.
              </>
            ) : (
              '.'
            )}
          </h1>
          <p className="hello-intro">{intro}</p>

          {home?.thought && (
            <article className="thought glass">
              <p className="label">{t(`today.thought.${part}` as MessageKey)}</p>
              <blockquote>{home.thought.text}</blockquote>
              <div className="thought-row">
                <Link to={thoughtPath(home.thought)} className="thought-source">
                  {home.thought.book ? (
                    <>
                      {t('today.from')} <i>{home.thought.book.title}</i>, {t('today.chapterRoman', { n: roman(home.thought.book.chapter) })}
                    </>
                  ) : (
                    <>
                      {t('today.from')} <i>{home.thought.post.title}</i>
                    </>
                  )}
                </Link>
                <span className="thought-acts">
                  {!isOwner && (
                    <button
                      type="button"
                      className={`round-btn${isBookmarked(home.thought.post.id) ? ' is-on' : ''}`}
                      aria-label={t('post.bookmark')}
                      title={t('post.bookmark')}
                      onClick={() => toggleBookmark(home.thought!.post.id)}
                    >
                      <Bookmark size={17} fill={isBookmarked(home.thought.post.id) ? 'currentColor' : 'none'} />
                    </button>
                  )}
                  <button type="button" className="round-btn" aria-label={t('share.title')} title={t('share.title')} onClick={() => void shareThought(home.thought!)}>
                    <Share2 size={17} />
                  </button>
                </span>
              </div>
            </article>
          )}
        </div>

        <article className="reading glass" aria-busy={!reading || !home}>
          <p className="label">{today?.fresh ? t('today.newChapter') : t('today.reading')}</p>
          {today ? (
            <>
              <div className="reading-top">
                <ProgressRing value={today.progress} size={narrow ? 104 : 150} thickness={narrow ? 8 : 10}>
                  {today.fresh ? (
                    <CoverOf book={today.book} mini />
                  ) : (
                    <>
                      <b>{today.progress}%</b>
                      <span>{t('today.minutesLeft', { n: today.minutesLeft })}</span>
                    </>
                  )}
                </ProgressRing>
                <div>
                  <Link to={bookPath(today.book.slug)} className="book-line">
                    <CoverOf book={today.book} mini />
                    <span>
                      {today.book.title} · {t('books.chapterOfShort', { n: today.chapter.no, total: totalOf(today.book) })}
                    </span>
                  </Link>
                  <h2>{today.chapter.title}</h2>
                  {today.chapter.excerpt && <p className="muted reading-excerpt">{today.chapter.excerpt}</p>}
                </div>
              </div>
              {today.chapter.slug && (
                <div className="reading-btns">
                  <Link to={chapterPath(today.book.slug, today.chapter.slug)} className="btn btn-warm">
                    <Play size={16} fill="currentColor" /> {today.fresh ? t('today.start') : t('today.continue')}
                  </Link>
                  <Link to={`${chapterPath(today.book.slug, today.chapter.slug)}?asculta=1`} className="btn btn-soft">
                    <Headphones size={17} /> {t('today.listen')}
                  </Link>
                </div>
              )}
            </>
          ) : (
            <div className="reading-empty">
              {home ? <p className="muted">{t('today.noBooks')}</p> : <div className="skeleton reading-skeleton" />}
            </div>
          )}
          {streak && <StreakWeek streak={streak} />}
        </article>
      </section>

      {error && <p className="form-error">{error}</p>}

      {journeys.length > 0 && (
        <section className="block">
          <div className="block-head">
            <h2>{t('today.journeys')}</h2>
            <p>{t('today.journeysHint')}</p>
            <ScrollHint target={journeysRow} compact />
            <Link to="/drumuri">
              {t('books.all')} <ArrowRight size={16} />
            </Link>
          </div>
          <div className="journeys" ref={journeysRow}>
            {journeys.map((journey) => (
              <JourneyCard key={journey.book.id} journey={journey} />
            ))}
          </div>
        </section>
      )}

      {home && (
        <section className="block">
          <div className="block-head">
            <h2>{t('today.subjects')}</h2>
            <p>{t('today.subjectsHint')}</p>
            {home.subjects.length > 0 && (
              <Link to="/subiecte">
                {t('books.all')} <ArrowRight size={16} />
              </Link>
            )}
          </div>
          {home.subjects.length > 0 ? (
            <div className="subjects">
              {home.subjects.slice(0, 6).map((subject, index) => (
                <SubjectTile key={subject.id} subject={subject} index={index} />
              ))}
            </div>
          ) : (
            <EmptyState compact icon={Compass} title={t('empty.subjects.title')} text={t('empty.subjects.text')}>
              {isOwner && (
                <Link to="/admin/categorii" className="btn btn-soft btn-sm">
                  {t('empty.subjects.manage')}
                </Link>
              )}
            </EmptyState>
          )}
        </section>
      )}

      {home && (
        <section className="block">
          <div className="block-head">
            <h2>{t('today.books')}</h2>
            <p>{t('today.booksHint', { n: home.books.length })}</p>
            {home.books.length > 0 && <ScrollHint target={booksRow} compact />}
            {home.books.length > 0 && (
              <Link to="/carti">
                {t('today.library')} <ArrowRight size={16} />
              </Link>
            )}
          </div>
          {home.books.length > 0 ? (
            <div className="books-row" ref={booksRow}>
              {home.books.slice(0, 6).map((book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>
          ) : (
            <EmptyState compact icon={Library} title={t('empty.books.title')} text={t('empty.books.text')}>
              {canWrite && (
                <Link to={newBookPath()} className="btn btn-warm btn-sm">
                  <Plus size={15} /> {t('empty.books.start')}
                </Link>
              )}
            </EmptyState>
          )}
        </section>
      )}

      {home && (
        <section className="block">
          <div className="block-head">
            <h2>{t('today.journal')}</h2>
            <p>{t('today.journalHint')}</p>
            {home.journal.length > 0 && (
              <Link to={journalPath()}>
                {t('today.allJournal')} <ArrowRight size={16} />
              </Link>
            )}
          </div>
          {home.journal.length > 0 ? (
            <ol className="timeline">
              {home.journal.map((post) => (
                <TimelineEntry key={post.id} post={post} />
              ))}
            </ol>
          ) : (
            <EmptyState compact icon={Feather} title={t('empty.journal.title')} text={t('empty.journal.text')}>
              {canWrite && (
                <Link to={newArticlePath()} className="btn btn-warm btn-sm">
                  <PenLine size={15} /> {t('empty.journal.write')}
                </Link>
              )}
            </EmptyState>
          )}
        </section>
      )}

      {narrow && <Dock reading={reading} />}
    </div>
  );
}
