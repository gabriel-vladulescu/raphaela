import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Check, Clock, Heart, MessageCircle, Moon } from 'lucide-react';
import { BookCover } from '@/components/BookCover';
import { PALETTES } from '@/lib/covers';
import { bookPath, chapterPath, subjectPath } from '@/lib/books';
import { useI18n } from '@/lib/i18n';
import type { Book, Journey, PostSummary, ReadingSummary, Subject } from '@/lib/types';
import { postPath } from '@/lib/paths';

// The books' small pieces, shared by the home page, the library, a book's page and the reader's journeys.

/** A book's cover with its own title, subject and author on it. */
export function CoverOf({ book, mini, label, className }: { book: Book; mini?: boolean; label?: boolean; className?: string }) {
  return (
    <BookCover
      design={book.cover}
      title={book.title}
      subject={book.subject?.name}
      author={book.author.name}
      mini={mini}
      label={label ? book.title : undefined}
      className={className}
    />
  );
}

/** "Being written · 9/14" or "Complete". */
export function BookStatus({ book }: { book: Book }) {
  const { t } = useI18n();
  if (book.complete) return <span className="book-chip is-done">{t('books.complete')}</span>;
  return (
    <span className="book-chip is-live">
      {t('books.writing')}
      {book.planned ? ` · ${book.chapters}/${book.planned}` : ` · ${t('books.chaptersN', { n: book.chapters })}`}
    </span>
  );
}

/** A book in a grid or a shelf: the cover, the title, its state. */
export function BookCard({ book, showSubject = false }: { book: Book; showSubject?: boolean }) {
  return (
    <Link to={bookPath(book.slug)} className="book-card">
      <CoverOf book={book} />
      <span className="book-card-text">
        <span className="book-card-title">{book.title}</span>
        {showSubject && book.subject && <span className="book-card-subject">{book.subject.name}</span>}
      </span>
      <BookStatus book={book} />
    </Link>
  );
}

/** A ring filling up to `value` percent, with what's inside it. */
export function ProgressRing({ value, size = 150, thickness = 10, children }: { value: number; size?: number; thickness?: number; children?: ReactNode }) {
  return (
    <span className="dial" style={{ '--size': `${size}px` } as CSSProperties}>
      <span className="ring" style={{ '--p': Math.round(value), '--thick': `${thickness}px` } as CSSProperties} aria-hidden="true" />
      {children && <span className="dial-center">{children}</span>}
    </span>
  );
}

/** The days of this week, ticked when the reader read. */
export function StreakWeek({ streak }: { streak: ReadingSummary['streak'] }) {
  const { t, locale } = useI18n();
  const letter = (day: string) => new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  return (
    <ol className="streak" aria-label={t('today.streakLabel', { n: streak.days })}>
      {streak.week.map((day) => (
        <li key={day.day} className={day.read ? 'is-done' : day.today ? 'is-today' : day.future ? 'is-future' : ''}>
          <i>{day.read ? <Check size={15} strokeWidth={2.6} /> : day.today ? <Moon size={14} /> : null}</i>
          <span>{letter(day.day)}</span>
        </li>
      ))}
    </ol>
  );
}

/** A book's colour (its journey's path, its chapter's accents): a strong shade of its cover's palette, or of its own colours. */
export const bookColor = (book: Book) =>
  book.cover.colors
    ? `color-mix(in srgb, ${book.cover.colors.c1} 45%, ${book.cover.colors.c2})`
    : (PALETTES[book.cover.palette]?.strong ?? 'var(--accent)');

/** A book the reader started: its chapters as a path of dots (read, now, still ahead), and what to read now. */
export function JourneyCard({ journey }: { journey: Journey }) {
  const { t } = useI18n();
  const { book, chapters, current } = journey;
  const total = Math.max(book.planned ?? 0, chapters.length);
  const dots = Array.from({ length: total }, (_, index) => chapters[index] ?? null);
  // The line runs up to the chapter being read (or the last one read).
  const reached = current ? chapters.findIndex((c) => c.current) : chapters.filter((c) => c.done).length - 1;
  const doneShare = total > 1 ? Math.max(0, reached) / (total - 1) : 0;
  const color = bookColor(book);
  const currentNo = current?.no ?? chapters.length;
  return (
    <article className="journey glass" style={{ '--c': color, '--done': Math.min(1, doneShare) } as CSSProperties}>
      <Link to={bookPath(book.slug)} className="journey-head">
        <CoverOf book={book} />
        <span>
          <span className="journey-title">{book.title}</span>
          <span className="journey-sub">
            {current ? t('books.chapterOf', { n: currentNo, total: total || chapters.length }) : t('books.allRead')}
            {book.subject ? ` · ${book.subject.name}` : ''}
          </span>
        </span>
      </Link>
      <div className="path" aria-hidden="true">
        {dots.map((chapter, index) => (
          <i key={index} className={chapter?.current ? 'is-now' : chapter?.done ? 'is-on' : ''} />
        ))}
      </div>
      {current?.slug ? (
        <Link to={chapterPath(book.slug, current.slug)} className="journey-next">
          <span>
            <span className="journey-next-label">{current.progress > 0 ? t('books.now') : t('books.next')}</span>
            <b>{current.title}</b>
          </span>
          <span className="journey-go" aria-hidden="true">
            <ArrowRight size={17} />
          </span>
        </Link>
      ) : (
        <p className="journey-next is-waiting">
          <span>
            <span className="journey-next-label">{book.complete ? t('books.finished') : t('books.waiting')}</span>
            <b>{book.complete ? t('books.finishedHint') : t('books.waitingHint')}</b>
          </span>
        </p>
      )}
    </article>
  );
}

/** Soft tiles, one colour each (styles/books.css), with a book of the subject peeking out. */
export function SubjectTile({ subject, index }: { subject: Subject; index: number }) {
  const { t } = useI18n();
  const parts = [
    subject.books > 0 ? t(subject.books === 1 ? 'today.bookOne' : 'today.booksN', { n: subject.books }) : null,
    subject.articles > 0 ? t(subject.articles === 1 ? 'today.articleOne' : 'today.articlesN', { n: subject.articles }) : null,
  ].filter(Boolean);
  return (
    <Link to={subjectPath(subject.slug)} className={`subject-tile tile-${index % 6}`}>
      <span className="subject-icon" aria-hidden="true">
        {subject.icon || '✦'}
      </span>
      <span>
        <span className="subject-name">{subject.name}</span>
        <span className="subject-count">{parts.join(' · ')}</span>
      </span>
      {subject.cover && (
        <span className="subject-peek">
          <BookCover design={subject.cover.cover} title={subject.cover.title} subject={subject.cover.subject} />
        </span>
      )}
    </Link>
  );
}

/** An article on the timeline: its day, then a card (category, title, summary, reading time, likes, comments, image). */
export function TimelineEntry({ post }: { post: PostSummary }) {
  const { t, locale, formatNumber } = useI18n();
  const date = post.publishedAt ? new Date(post.publishedAt) : null;
  return (
    <li className="timeline-entry">
      <div className="timeline-date" aria-hidden="true">
        {date && (
          <>
            <b>{date.getDate()}</b>
            <span>{new Intl.DateTimeFormat(locale, { month: 'short' }).format(date).replace('.', '')}</span>
          </>
        )}
      </div>
      <Link to={postPath(post)} className="timeline-card glass">
        <div>
          {post.category && <span className="book-chip">{post.category.name}</span>}
          <h3>{post.title}</h3>
          <p className="timeline-excerpt">{post.excerpt}</p>
          <p className="timeline-meta">
            <span>
              <Clock size={14} /> {t('books.minutes', { n: post.readingMinutes })}
            </span>
            <span>
              <Heart size={14} /> {formatNumber(post.likeCount)}
            </span>
            {post.commentsEnabled && post.commentCount > 0 && (
              <span>
                <MessageCircle size={14} /> {formatNumber(post.commentCount)}
              </span>
            )}
          </p>
        </div>
        {post.bannerUrl ? <img src={post.bannerUrl} alt="" loading="lazy" /> : <span className="timeline-glyph">{post.category?.icon || '✦'}</span>}
      </Link>
    </li>
  );
}
