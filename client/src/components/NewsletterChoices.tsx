import { Link } from 'react-router';
import { BookOpen } from 'lucide-react';
import { bookPath } from '@/lib/books';
import { useI18n } from '@/lib/i18n';

/** A book an address gets the new chapters of. */
export interface FollowedBook {
  id: number;
  title: string;
  slug: string;
}

/**
 * What an address gets by email (Settings, and the page its emails' link opens): every new post (a switch), and the
 * books it follows ("Notify me" at the end of an unfinished book), each of which can be stopped.
 */
export function NewsletterChoices(props: {
  allPosts: boolean;
  books: FollowedBook[];
  busy: boolean;
  onAllPosts: (on: boolean) => void;
  onDropBook: (bookId: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="newsletter-choices">
      <label className="switch-field">
        <span className="switch-text">
          <strong>{t('newsletter.allPosts')}</strong>
          <span className="field-hint">{t('newsletter.allPostsHint')}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={props.allPosts}
          disabled={props.busy}
          onChange={(event) => props.onAllPosts(event.target.checked)}
        />
      </label>
      {props.books.length > 0 && (
        <div className="newsletter-books">
          <p className="field-label">{t('newsletter.books')}</p>
          <ul>
            {props.books.map((book) => (
              <li key={book.id}>
                <BookOpen size={16} aria-hidden="true" />
                <Link to={bookPath(book.slug)}>{book.title}</Link>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={props.busy}
                  aria-label={t('newsletter.dropBookLabel', { book: book.title })}
                  onClick={() => props.onDropBook(book.id)}
                >
                  {t('newsletter.dropBook')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
