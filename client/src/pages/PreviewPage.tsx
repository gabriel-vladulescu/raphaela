import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CalendarClock, Clock, Eye } from 'lucide-react';
import { AuthorSignature } from '@/components/AuthorSignature';
import { BannerCredit } from '@/components/BannerCredit';
import { TagChip } from '@/components/TagChip';
import { site } from '@/config';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { Post } from '@/lib/types';
import { postPath } from '@/lib/paths';

/**
 * A post opened by its preview link (/previzualizare/:token), which its author can send to someone before it goes
 * up: the article as it will look, without the discussion, reactions or statistics. The link stops working when the
 * author turns it off (the editor); the page isn't for search engines (server/src/seo/page.ts).
 */
export function PreviewPage() {
  const { token = '' } = useParams();
  const { t, formatDateTime } = useI18n();
  const [post, setPost] = useState<Post | null>(null);
  const [failed, setFailed] = useState<'not_found' | 'error' | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ post: Post }>(`/preview/${encodeURIComponent(token)}`)
      .then((data) => !cancelled && setPost(data.post))
      .catch((err) => !cancelled && setFailed(err instanceof ApiError && err.status === 404 ? 'not_found' : 'error'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    document.title = post ? `${t('preview.title')}: ${post.title} · ${site.name}` : site.name;
    return () => {
      document.title = site.name;
    };
  }, [post, t]);

  if (failed) {
    return (
      <div className="container">
        <div className="empty-state card">
          <span className="empty-glyph" aria-hidden="true">☾</span>
          <p>{t(failed === 'not_found' ? 'preview.notFound' : 'post.loadFailed')}</p>
          <Link to="/" className="btn btn-secondary">
            {t('post.backHome')}
          </Link>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="container post-skeleton" aria-busy="true">
        <div className="skeleton skeleton-banner" />
      </div>
    );
  }

  const live = post.status === 'published' && !post.deleted;
  return (
    <article className="post-page preview-page container">
      <div className="notice preview-notice">
        <span className="badge badge-status-draft">
          <Eye size={13} /> {t('preview.title')}
        </span>
        <span className="muted">{t(live ? 'preview.live' : 'preview.notice')}</span>
        {live && (
          <Link to={postPath(post)} className="btn btn-secondary btn-sm">
            {t('preview.open')}
          </Link>
        )}
      </div>

      <header className={`post-hero${post.bannerUrl ? '' : ' is-plain'}`}>
        {post.bannerUrl ? (
          <>
            <img className="post-hero-img" src={post.bannerUrl} alt="" />
            <BannerCredit credit={post.bannerCredit} />
          </>
        ) : (
          <span className="post-hero-glyph" aria-hidden="true">
            {post.category?.icon || '✦'}
          </span>
        )}
        <div className="post-hero-text">
          {post.category && (
            <nav className="post-categories">
              <span className="chip">
                {post.category.icon && <span aria-hidden="true">{post.category.icon}</span>}
                {post.category.name}
              </span>
            </nav>
          )}
          <h1 className="post-title">{post.title || t('post.untitled')}</h1>
        </div>
      </header>

      <div className="post-meta">
        {post.status === 'scheduled' && post.publishedAt && (
          <span>
            <CalendarClock size={15} /> {t('post.scheduledFor', { date: formatDateTime(post.publishedAt) })}
          </span>
        )}
        <span>
          <Clock size={15} /> {t('post.readingTime', { n: post.readingMinutes })}
        </span>
      </div>

      <div className="preview-body">
        {/* Sanitized on the server when the post is saved. */}
        <div className="prose post-content" dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
        {post.tags.length > 0 && (
          <div className="post-tags">
            {post.tags.map((tag) => (
              <TagChip key={tag.slug} tag={tag} />
            ))}
          </div>
        )}
        <div className="card side-card preview-author">
          <AuthorSignature author={post.author} label={t('post.aboutAuthor')} side />
        </div>
      </div>
    </article>
  );
}
