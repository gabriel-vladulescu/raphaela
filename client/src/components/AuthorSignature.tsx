import type { ReactNode } from 'react';
import { Quote } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { useI18n } from '@/lib/i18n';

interface SignatureAuthor {
  name: string;
  picture: string | null;
  occupation: string | null;
  quote: string | null;
  /** With it: their @name, at the bottom. */
  username?: string;
}

/**
 * The author, as a card's content: a `label` ("The book's author", "About the author"), who they are (picture, name,
 * their occupation, else "Author"), their quote, and at the bottom their @name. `action` (Follow) sits beside the
 * name, or at the bottom where the card is narrow (`side`, the sidebar). `compact` (under the end on narrow screens):
 * the label only for screen readers, a smaller picture, the occupation alone under the name (no @name, so a long one
 * has the room), a small Follow, and the quote in two lines at most.
 * The post page (sidebar, and under the end on narrow screens), the profile's preview, a draft's preview.
 */
export function AuthorSignature({
  author,
  label,
  action,
  side,
  compact,
}: {
  author: SignatureAuthor;
  label?: string;
  action?: ReactNode;
  side?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const foot = !compact && (Boolean(author.username) || (side && Boolean(action)));
  return (
    <div className={`author-card${side ? ' is-side' : ''}${compact ? ' is-compact' : ''}`}>
      {label && <span className={compact ? 'visually-hidden' : 'author-card-label'}>{label}</span>}
      <div className="author-card-who">
        <span className="author-card-avatar">
          <Avatar name={author.name} picture={author.picture} size={compact ? 42 : 50} />
        </span>
        <span className="author-card-name">
          <strong>{author.name}</strong>
          <span>{author.occupation || t('post.author')}</span>
        </span>
        {!side && action && <div className="author-card-action">{action}</div>}
      </div>
      {author.quote && (
        <p className="author-card-quote">
          {!compact && <Quote size={20} fill="currentColor" strokeWidth={0} aria-hidden="true" />}
          {author.quote}
        </p>
      )}
      {foot && (
        <div className="author-card-foot">
          {side ? action : <span>@{author.username}</span>}
        </div>
      )}
    </div>
  );
}
