import { Avatar } from '@/components/Avatar';
import { useI18n } from '@/lib/i18n';

interface SignatureAuthor {
  name: string;
  picture: string | null;
  occupation: string | null;
  quote: string | null;
}

/** The author, centred: picture, name, their occupation (else "Author") and their quote. */
export function AuthorSignature({ author }: { author: SignatureAuthor }) {
  const { t } = useI18n();
  return (
    <div className="author-signature">
      <Avatar name={author.name} picture={author.picture} size={56} />
      <strong className="author-signature-name">{author.name}</strong>
      <span className="author-signature-role">{author.occupation || t('post.author')}</span>
      {author.quote && <p className="author-signature-quote">{t('quote.wrap', { text: author.quote })}</p>}
    </div>
  );
}
