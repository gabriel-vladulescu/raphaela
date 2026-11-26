import { useI18n } from '@/lib/i18n';
import type { PostSummary } from '@/lib/types';

/** Who made a post's banner and its licence (an image from a library), in a corner of the banner; linked to its page. */
export function BannerCredit({ credit }: { credit: PostSummary['bannerCredit'] }) {
  const { t } = useI18n();
  if (!credit) return null;
  const text = t('post.imageCredit', { credit: credit.text });
  return (
    <small className="post-hero-credit">
      {credit.url ? (
        <a href={credit.url} target="_blank" rel="noopener noreferrer nofollow">
          {text}
        </a>
      ) : (
        text
      )}
    </small>
  );
}
