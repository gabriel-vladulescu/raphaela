import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Hash, Pencil, Trash2 } from 'lucide-react';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminTag } from '@/admin/types';
import { Card, ConfirmDialog, Dialog, Empty, ErrorNote, Field, Loading, SearchBox } from '@/admin/ui';
import { TagStyleFields } from '@/components/editor/TagPicker';
import { TagChip } from '@/components/TagChip';
import { api } from '@/lib/api';
import { TAG_NAME_MAX, tagName, tagSlug, typingTagName } from '@/lib/tags';

/**
 * The posts' tags (the editor adds them): how many posts each has; rename one, or change its colour and sign (onto
 * another's name merges the two, so "café-noir" and "cafe-noir" become one), or delete it (the posts keep
 * everything else). Names are lower case, the words joined by dashes (tagStyles.ts).
 */
export function TagsCard() {
  const { t, errorMessage, formatNumber } = useAdminI18n();
  const [q, setQ] = useState('');
  const [tags, setTags] = useState<AdminTag[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<AdminTag | null>(null);
  const [name, setName] = useState('');
  const [look, setLook] = useState<{ color: string | null; icon: string | null }>({ color: null, icon: null });
  const [deleting, setDeleting] = useState<AdminTag | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setFailed(false);
    api<{ tags: AdminTag[] }>(`/admin/tags${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      .then((data) => setTags(data.tags))
      .catch(() => setFailed(true));
  }, [q]);
  useEffect(() => {
    const timer = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      setEditing(null);
      setDeleting(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const shaped = tagName(name);
  const other = editing && tags?.find((tag) => tag.id !== editing.id && tag.slug === tagSlug(shaped));
  const changed = Boolean(editing && (shaped !== editing.name || look.color !== editing.color || look.icon !== editing.icon));

  return (
    <>
      <Card title={t('tags.title')} actions={<SearchBox value={q} onChange={setQ} placeholder={t('tags.search')} />}>
        <p className="adm-muted adm-small adm-card-intro">{t('tags.subtitle')}</p>
        {failed ? (
          <ErrorNote message={t('common.loadFailed')} onRetry={load} />
        ) : !tags ? (
          <Loading />
        ) : tags.length === 0 ? (
          <Empty icon={Hash} title={q ? t('tags.noneFound') : t('tags.none')} body={q ? undefined : t('tags.noneBody')} />
        ) : (
          <ul className="adm-tags">
            {tags.map((tag) => (
              <li key={tag.id} className="adm-tag">
                <span className="adm-tag-name">
                  <TagChip tag={tag} />
                </span>
                <span className="adm-muted adm-small">{t('tags.posts', { n: formatNumber(tag.posts) })}</span>
                <span className="adm-row-actions">
                  <a href={`/eticheta/${tag.slug}`} target="_blank" rel="noopener" className="adm-icon-btn" title={t('tags.open')} aria-label={t('tags.open')}>
                    <ExternalLink size={15} />
                  </a>
                  <button
                    type="button"
                    className="adm-icon-btn"
                    title={t('tags.rename')}
                    aria-label={t('tags.rename')}
                    onClick={() => {
                      setEditing(tag);
                      setName(tag.name);
                      setLook({ color: tag.color, icon: tag.icon });
                      setError('');
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button type="button" className="adm-icon-btn is-danger" title={t('tags.delete')} aria-label={t('tags.delete')} onClick={() => setDeleting(tag)}>
                    <Trash2 size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && (
        <Dialog
          title={t('tags.rename')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className="adm-btn is-ghost" onClick={() => setEditing(null)} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="adm-btn is-primary"
                disabled={busy || !shaped || !changed}
                onClick={() => void run(() => api(`/admin/tags/${editing.id}`, { method: 'PUT', body: { name: shaped, ...look } }))}
              >
                {busy ? t('common.loading') : other ? t('tags.merge') : t('common.save')}
              </button>
            </>
          }
        >
          <Field label={t('tags.name')} hint={other ? t('tags.mergeHint', { name: other.name, n: other.posts }) : t('tags.renameHint')}>
            <input className="adm-input" value={name} maxLength={TAG_NAME_MAX} autoFocus spellCheck={false} onChange={(event) => setName(typingTagName(event.target.value))} />
          </Field>
          {!other && (
            <div className="adm-tag-look">
              <TagChip tag={{ name: shaped || editing.name, ...look }} />
              <TagStyleFields color={look.color} icon={look.icon} onChange={(next) => setLook({ ...look, ...next })} />
            </div>
          )}
          {error && <p className="adm-form-error">{error}</p>}
        </Dialog>
      )}
      {deleting && (
        <ConfirmDialog
          title={t('tags.delete')}
          body={t('tags.deleteBody', { name: deleting.name, n: deleting.posts })}
          confirmLabel={t('tags.delete')}
          danger
          busy={busy}
          error={error}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void run(() => api(`/admin/tags/${deleting.id}`, { method: 'DELETE' }))}
        />
      )}
    </>
  );
}
