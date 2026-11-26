import { useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight, Bell, BookOpen, CalendarClock, Check, ListOrdered, Lock } from 'lucide-react';
import { bookColor, CoverOf } from '@/components/Books';
import { Modal } from '@/components/Modal';
import { bookPath, chapterPath, roman } from '@/lib/books';
import { useI18n } from '@/lib/i18n';
import { openBookNotify } from '@/lib/newsletterSheet';
import type { Book, Chapter } from '@/lib/types';

// A book's chapter, as its page shows it (PostPage): the opening (the book, the chapter's number and title, where it
// is in the book), the end (the chapters before and after; on phones the way on is in the bottom bar), the contents
// (in the sidebar, or a sheet on phones).

export type ChapterBook = Book & { contents: Chapter[] };

/** Where a chapter is in its book: its index, the chapters around it, and how many there are (or will be). */
export function chapterPlace(book: ChapterBook, postId: number) {
  const contents = book.contents;
  const index = contents.findIndex((chapter) => chapter.id === postId);
  const shown = contents.filter((chapter) => chapter.state !== 'draft' || chapter.id === postId);
  const previous = index > 0 ? [...contents.slice(0, index)].reverse().find((chapter) => chapter.slug) : undefined;
  const after = index >= 0 ? contents.slice(index + 1).find((chapter) => chapter.state !== 'draft') : undefined;
  return {
    index,
    no: contents[index]?.no ?? 1,
    total: Math.max(book.planned ?? 0, shown.length),
    shown,
    previous,
    /** The next one: open (it has a slug), or only announced (scheduled, with its date). */
    after,
  };
}

export type ChapterPlace = ReturnType<typeof chapterPlace>;

/** The chapter's segments: read before it, this one, still ahead. */
function Segments({ place }: { place: ChapterPlace }) {
  return (
    <div className="segments" aria-hidden="true">
      {Array.from({ length: place.total }, (_, i) => (
        <i key={i} className={i < place.index ? 'is-on' : i === place.index ? 'is-now' : ''} />
      ))}
    </div>
  );
}

/**
 * The top of a chapter, like a book's opening page: the book it's from, "Chapter" and its number, the title, where it
 * is in the book, and the date, reading time, views and "Listen" (`meta`). Double-tapping it likes it (`onPointerUp`,
 * with the hearts in `bursts`).
 */
export function ChapterOpening({
  book,
  place,
  title,
  meta,
  bursts,
  onPointerUp,
}: {
  book: ChapterBook;
  place: ChapterPlace;
  title: string;
  meta: ReactNode;
  bursts: ReactNode;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const { t } = useI18n();
  return (
    <header className="chapter-opening" style={{ '--c': bookColor(book) } as CSSProperties} onPointerUp={onPointerUp}>
      {bursts}
      <Link to={bookPath(book.slug)} className="chapter-book">
        <CoverOf book={book} mini />
        <span>
          <span className="chapter-book-title">{book.title}</span>
          {book.subject && <span className="chapter-book-subject">{book.subject.name}</span>}
        </span>
      </Link>
      <p className="chapter-numeral">
        <span>{t('books.chapterWord')}</span>
        {roman(place.no)}
      </p>
      <h1 className="chapter-title">{title}</h1>
      <div className="chapter-where">
        <Segments place={place} />
        <span>{t('books.ofTotal', { n: place.index + 1, total: place.total })}</span>
      </div>
      <div className="chapter-meta">{meta}</div>
    </header>
  );
}

/** "Notify me" when the next chapter isn't out: a sheet (NewsletterSheet) to hear of the book's new chapters, on this
 *  device, by email, or both. */
const canNotify = (book: ChapterBook) => !book.complete;

export function ChapterNotify({ book, className, children }: { book: ChapterBook; className: string; children: ReactNode }) {
  return (
    <button type="button" className={className} aria-haspopup="dialog" onClick={() => openBookNotify({ id: book.id, title: book.title })}>
      {children}
    </button>
  );
}

/**
 * The end of a chapter: a closing line, where the reader is in the book, and the way on. Wide screens: the chapter
 * before and the one after, side by side (or the day it comes out, or the end of what's written). Narrow ones: only
 * the chapter before, as a small button; the way on is in the bottom bar there (ChapterOnward). Liking and sharing
 * are in the sidebar and the bar.
 */
export function ChapterEnd({ book, place }: { book: ChapterBook; place: ChapterPlace }) {
  const { t, formatDate } = useI18n();
  const { previous, after } = place;
  const end = t('books.endOfChapter', { n: roman(place.no) });
  return (
    <section className="chapter-end" style={{ '--c': bookColor(book) } as CSSProperties} aria-label={end}>
      <p className="chapter-fin">
        <span aria-hidden="true">✦</span>
        {end}
        <span aria-hidden="true">✦</span>
      </p>

      <div className="chapter-end-where">
        <Segments place={place} />
        <span>{t('books.reachedOf', { n: place.index + 1, total: place.total })}</span>
      </div>

      {previous?.slug && (
        <Link to={chapterPath(book.slug, previous.slug)} className="chapter-prev-pill">
          <span className="chapter-prev-pill-icon" aria-hidden="true">
            <ArrowLeft size={18} />
          </span>
          <span className="chapter-prev-pill-text">
            <span>{t('books.previous')}</span>
            <strong>
              {roman(previous.no)} · {previous.title}
            </strong>
          </span>
        </Link>
      )}

      <nav className="chapter-turn" aria-label={t('books.contents')}>
        {previous?.slug && (
          <Link to={chapterPath(book.slug, previous.slug)} className="chapter-turn-prev">
            <span className="chapter-turn-label">
              <ArrowLeft size={14} /> {t('books.nextChapter', { n: roman(previous.no) })}
            </span>
            <strong>{previous.title}</strong>
          </Link>
        )}
        {after?.slug ? (
          <Link to={chapterPath(book.slug, after.slug)} className="chapter-turn-next">
            <span className="chapter-turn-label">
              {t('books.nextChapter', { n: roman(after.no) })} · {t('books.minutes', { n: after.minutes })}
            </span>
            <strong>{after.title}</strong>
            {after.excerpt && <span className="chapter-turn-excerpt">{after.excerpt}</span>}
            <span className="chapter-turn-go">
              {t('books.readOn')} <ArrowRight size={17} />
            </span>
          </Link>
        ) : (
          <div className="chapter-turn-next is-quiet">
            <span className="chapter-turn-label">
              {after?.publishedAt ? (
                <>
                  <CalendarClock size={14} /> {t('books.nextChapter', { n: roman(after.no) })} · {t('books.comesOn', { date: formatDate(after.publishedAt) })}
                </>
              ) : (
                <>
                  <BookOpen size={14} /> {book.complete ? t('books.theEnd') : t('books.forNow')}
                </>
              )}
            </span>
            <strong>{after ? after.title : book.complete ? t('books.endOfBook') : t('books.readAllWritten')}</strong>
            {canNotify(book) && <span className="chapter-turn-excerpt">{t('books.notifyHint')}</span>}
            {canNotify(book) ? (
              <ChapterNotify book={book} className="chapter-turn-go">
                <Bell size={17} /> {t('books.notifyMe')}
              </ChapterNotify>
            ) : (
              <Link to={bookPath(book.slug)} className="chapter-turn-go">
                {t('books.backToBook')} <BookOpen size={17} />
              </Link>
            )}
          </div>
        )}
      </nav>
    </section>
  );
}

/**
 * Narrow screens, once the chapter's text is read: the bottom bar's way on, where its round button was. The next
 * chapter; if it isn't out, "Notify me" (or back to the book); at the end of the book, back to it.
 */
export function ChapterOnward({ book, place, onGo }: { book: ChapterBook; place: ChapterPlace; onGo?: () => void }) {
  const { t, locale } = useI18n();
  const { after } = place;
  if (after?.slug) {
    return (
      <Link to={chapterPath(book.slug, after.slug)} className="post-bar-onward" style={{ '--c': bookColor(book) } as CSSProperties} onClick={onGo}>
        <span className="post-bar-onward-text">
          <span>{t('books.nextChapter', { n: roman(after.no) })}</span>
          <strong>{after.title}</strong>
        </span>
        <span className="post-bar-onward-go" aria-hidden="true">
          <ArrowRight size={20} />
        </span>
      </Link>
    );
  }
  // A chapter comes out within weeks: the day and month are enough (the bar is narrow).
  const label = after?.publishedAt
    ? t('books.comesOn', { date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(after.publishedAt)) })
    : book.complete
      ? t('books.theEnd')
      : t('books.forNow');
  if (canNotify(book)) {
    return (
      <ChapterNotify book={book} className="post-bar-onward is-quiet">
        <span className="post-bar-onward-text">
          <span>{label}</span>
          <strong>{t('books.notifyMe')}</strong>
        </span>
        <span className="post-bar-onward-go" aria-hidden="true">
          <Bell size={20} />
        </span>
      </ChapterNotify>
    );
  }
  return (
    <Link to={bookPath(book.slug)} className="post-bar-onward is-quiet" onClick={onGo}>
      <span className="post-bar-onward-text">
        <span>{label}</span>
        <strong>{t('books.backToBook')}</strong>
      </span>
      <span className="post-bar-onward-go" aria-hidden="true">
        <BookOpen size={20} />
      </span>
    </Link>
  );
}

/** The chapters as a list: the ones before this one ticked, this one marked, the ones not out yet locked. */
export function ChapterList({ book, place, postId, onPick }: { book: ChapterBook; place: ChapterPlace; postId: number; onPick?: () => void }) {
  const { t, formatShortDate } = useI18n();
  return (
    <ol className="chapter-list-nav">
      {place.shown.map((chapter, index) => {
        const current = chapter.id === postId;
        const body = (
          <>
            <span className="chapter-list-no">{roman(chapter.no)}</span>
            <span className="chapter-list-text">
              <span className="chapter-list-title">{chapter.title}</span>
              {chapter.state === 'scheduled' && chapter.publishedAt && (
                <span className="chapter-list-when">{t('books.comesOn', { date: formatShortDate(chapter.publishedAt) })}</span>
              )}
            </span>
            {current ? null : chapter.slug === null ? (
              <Lock size={14} className="chapter-list-icon" aria-hidden="true" />
            ) : index < place.index ? (
              <Check size={14} className="chapter-list-icon is-done" aria-hidden="true" />
            ) : null}
          </>
        );
        return (
          <li key={chapter.id}>
            {current ? (
              <span className="chapter-list-item is-current" aria-current="page">
                {body}
              </span>
            ) : chapter.slug ? (
              <Link to={chapterPath(book.slug, chapter.slug)} className="chapter-list-item" onClick={onPick}>
                {body}
              </Link>
            ) : (
              <span className="chapter-list-item is-locked">{body}</span>
            )}
          </li>
        );
      })}
      {book.planned && book.planned > place.shown.length && (
        <li>
          <span className="chapter-list-item is-planned">
            <span className="chapter-list-no">
              {roman(place.shown.length + 1)}
              {book.planned > place.shown.length + 1 ? `–${roman(book.planned)}` : ''}
            </span>
            <span className="chapter-list-text">
              <span className="chapter-list-title">{book.planned - place.shown.length === 1 ? t('books.planned') : t('books.stillToWrite')}</span>
            </span>
          </span>
        </li>
      )}
    </ol>
  );
}

/** The sidebar's book card (wide screens): the book, where this chapter is in it, and the contents. */
export function ChapterSideCard({ book, place, postId }: { book: ChapterBook; place: ChapterPlace; postId: number }) {
  const { t } = useI18n();
  return (
    <nav className="card side-card chapter-side" aria-label={t('books.contents')} style={{ '--c': bookColor(book) } as CSSProperties}>
      <Link to={bookPath(book.slug)} className="chapter-side-head">
        <CoverOf book={book} />
        <span>
          <span className="side-title">{t('books.contents')}</span>
          <strong>{book.title}</strong>
          <span className="muted">{t('books.ofTotal', { n: place.index + 1, total: place.total })}</span>
        </span>
      </Link>
      <Segments place={place} />
      <ChapterList book={book} place={place} postId={postId} />
    </nav>
  );
}

/** Phones: "Contents" in the bottom bar, opening the chapters in a sheet (`compact`: just the icon, at the end). */
export function ChapterContentsButton({ book, place, postId, compact }: { book: ChapterBook; place: ChapterPlace; postId: number; compact?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`reaction-btn${compact ? '' : ' reaction-btn-lg'}`}
        aria-haspopup="dialog"
        aria-label={compact ? t('books.contents') : undefined}
        title={compact ? t('books.contents') : undefined}
        onClick={() => setOpen(true)}
      >
        <ListOrdered size={20} />
        {!compact && <span>{t('books.contents')}</span>}
      </button>
      {open && (
        <Modal title={book.title} onClose={() => setOpen(false)} closeOnBackdrop sheet className="chapter-sheet">
          {/* The book and where the reader is stay on top; its chapters scroll under them. */}
          <div className="chapter-sheet-head" style={{ '--c': bookColor(book) } as CSSProperties}>
            <Link to={bookPath(book.slug)} className="chapter-side-head" onClick={() => setOpen(false)}>
              <CoverOf book={book} />
              <span>
                <span className="side-title">{t('books.contents')}</span>
                <strong>{book.title}</strong>
                <span className="muted">{t('books.ofTotal', { n: place.index + 1, total: place.total })}</span>
              </span>
            </Link>
            <Segments place={place} />
          </div>
          <div className="chapter-sheet-body" style={{ '--c': bookColor(book) } as CSSProperties}>
            <ChapterList book={book} place={place} postId={postId} onPick={() => setOpen(false)} />
          </div>
        </Modal>
      )}
    </>
  );
}
