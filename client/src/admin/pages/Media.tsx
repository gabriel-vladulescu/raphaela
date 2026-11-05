import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Copy, ExternalLink, History, ImageOff, Images, Sparkles, Trash2 } from 'lucide-react';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import type { MediaItem } from '@/admin/types';
import { Badge, Card, ConfirmDialog, Empty, ErrorNote, Loading, PageHead, Tabs } from '@/admin/ui';
import { api } from '@/lib/api';

const FILTERS = ['all', 'used', 'unused'] as const;
type Filter = (typeof FILTERS)[number];

interface MediaList {
  media: MediaItem[];
  counts: Record<Filter, number>;
  totalSize: number;
  unusedSize: number;
}

/** Bytes, readably (KB, MB). */
function useSize() {
  const { formatNumber } = useAdminI18n();
  return (bytes: number) =>
    bytes >= 1024 * 1024 ? `${formatNumber(Math.round((bytes / 1024 / 1024) * 10) / 10)} MB` : `${formatNumber(bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/**
 * The media library: every picture posts were given (banners, pictures in the text, share images), where each is
 * used, and those nothing uses any more, to delete one by one or all at once. A picture only an earlier version of a
 * post has, or one uploaded in the last day (maybe in an editor not saved yet), isn't counted as unused.
 */
export function MediaPage() {
  const { t, formatShortDate } = useAdminI18n();
  const size = useSize();
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS.find((f) => f === params.get('filter')) ?? 'all') as Filter;
  const [data, setData] = useState<MediaList | null>(null);
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState<MediaItem | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    api<MediaList>(`/admin/media?filter=${filter}`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [filter]);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      setDeleting(null);
      setCleaning(false);
      load();
    } catch {
      setError(t('common.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function copy(item: MediaItem) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${item.url}`);
      setCopied(item.name);
      setTimeout(() => setCopied((name) => (name === item.name ? null : name)), 1500);
    } catch {
      // no clipboard here
    }
  }

  return (
    <>
      <PageHead
        title={t('nav.media')}
        subtitle={data ? t('media.subtitle', { n: data.counts.all, size: size(data.totalSize) }) : t('media.subtitleShort')}
        actions={
          data && data.counts.unused > 0 ? (
            <button type="button" className="adm-btn is-danger-ghost" onClick={() => setCleaning(true)}>
              <Sparkles size={16} /> {t('media.cleanup', { n: data.counts.unused, size: size(data.unusedSize) })}
            </button>
          ) : undefined
        }
      />
      <Card flush>
        <div className="adm-toolbar">
          <Tabs<Filter>
            label={t('media.filter')}
            value={filter}
            onChange={(value) => setParams(value === 'all' ? {} : { filter: value })}
            items={FILTERS.map((value) => ({ value, label: t(`media.filter.${value}` as AdminKey), count: data?.counts[value] }))}
          />
        </div>
        {error && <p className="adm-form-error adm-pad">{error}</p>}
        {failed ? (
          <ErrorNote message={t('common.loadFailed')} onRetry={load} />
        ) : !data ? (
          <Loading />
        ) : data.media.length === 0 ? (
          <div className="adm-pad">
            <Empty icon={filter === 'unused' ? Sparkles : Images} title={filter === 'unused' ? t('media.noUnused') : t('media.none')} />
          </div>
        ) : (
          <ul className="adm-media">
            {data.media.map((item) => {
              const unused = item.posts.length === 0 && !item.inVersions && !item.recent;
              return (
                <li key={item.name} className={`adm-media-item${unused ? ' is-unused' : ''}`}>
                  <a href={item.url} target="_blank" rel="noopener" className="adm-media-thumb" aria-label={`${t('media.open')}: ${item.name}`}>
                    <img src={item.url} alt="" loading="lazy" />
                  </a>
                  <div className="adm-media-info">
                    <span className="adm-small adm-muted">
                      {size(item.size)} · {formatShortDate(item.modifiedAt)}
                    </span>
                    {item.posts.length > 0 ? (
                      <ul className="adm-media-posts">
                        {item.posts.slice(0, 2).map((post) => (
                          <li key={post.id}>
                            <a href={`/posts/${post.slug}`} target="_blank" rel="noopener" className="adm-small" title={post.title}>
                              {post.title}
                            </a>
                            {post.deleted && <Badge tone="bad">{t('posts.status.deleted')}</Badge>}
                          </li>
                        ))}
                        {item.posts.length > 2 && <li className="adm-small adm-muted">{t('media.morePosts', { n: item.posts.length - 2 })}</li>}
                      </ul>
                    ) : item.inVersions ? (
                      <span className="adm-small adm-muted">
                        <History size={12} aria-hidden="true" /> {t('media.inVersions')}
                      </span>
                    ) : item.recent ? (
                      <span className="adm-small adm-muted">{t('media.recent')}</span>
                    ) : (
                      <span className="adm-small adm-media-unused">
                        <ImageOff size={12} aria-hidden="true" /> {t('media.unused')}
                      </span>
                    )}
                  </div>
                  <div className="adm-media-actions">
                    <button type="button" className="adm-icon-btn" title={copied === item.name ? t('media.copied') : t('media.copy')} aria-label={t('media.copy')} onClick={() => void copy(item)}>
                      <Copy size={15} />
                    </button>
                    <a href={item.url} target="_blank" rel="noopener" className="adm-icon-btn" title={t('media.open')} aria-label={t('media.open')}>
                      <ExternalLink size={15} />
                    </a>
                    {/* Only what nothing uses (the server refuses the rest). */}
                    {unused && (
                      <button type="button" className="adm-icon-btn is-danger" title={t('media.delete')} aria-label={t('media.delete')} onClick={() => setDeleting(item)}>
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {deleting && (
        <ConfirmDialog
          title={t('media.delete')}
          body={t('media.deleteBody')}
          confirmLabel={t('media.delete')}
          danger
          busy={busy}
          error={error}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void run(() => api(`/admin/media/${encodeURIComponent(deleting.name)}`, { method: 'DELETE' }))}
        />
      )}
      {cleaning && data && (
        <ConfirmDialog
          title={t('media.cleanupTitle')}
          body={t('media.cleanupBody', { n: data.counts.unused, size: size(data.unusedSize) })}
          confirmLabel={t('media.cleanupConfirm')}
          danger
          busy={busy}
          error={error}
          onCancel={() => setCleaning(false)}
          onConfirm={() => void run(() => api('/admin/media/cleanup', { method: 'POST' }))}
        />
      )}
    </>
  );
}
