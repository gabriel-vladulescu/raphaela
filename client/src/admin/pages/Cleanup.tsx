import { useCallback, useEffect, useState } from 'react';
import { Archive, CircleCheck, Trash2 } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import { Badge, Card, ConfirmDialog, Empty, ErrorNote, Loading } from '@/admin/ui';
import { api } from '@/lib/api';

interface DueItem {
  key: string;
  /** Rows past their keeping period. */
  count: number;
  /** When the oldest of them is from. */
  oldest: string | null;
}

/**
 * Data past the time the Terms promise to keep it (lib/retention.ts on the server). The site never deletes it by
 * itself: administrators are told when there is some (at most once a week), and delete it here, one kind or all.
 */
export function CleanupSettings() {
  const { t, formatNumber, formatShortDate } = useAdminI18n();
  const { refreshOverview } = useAdmin();
  const [items, setItems] = useState<DueItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** What's about to be deleted (asked first): some kinds, or all of them. */
  const [deleting, setDeleting] = useState<DueItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<number | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    api<{ items: DueItem[] }>('/admin/cleanup')
      .then((data) => setItems(data.items))
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  async function remove(chosen: DueItem[]) {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ deleted: Record<string, number>; items: DueItem[] }>('/admin/cleanup', {
        method: 'POST',
        body: { keys: chosen.map((item) => item.key) },
      });
      setItems(data.items);
      setDone(Object.values(data.deleted).reduce((sum, n) => sum + n, 0));
      setDeleting(null);
      refreshOverview();
    } catch {
      setError(t('cleanup.failed'));
    } finally {
      setBusy(false);
    }
  }

  const due = items?.filter((item) => item.count > 0) ?? [];
  const total = due.reduce((sum, item) => sum + item.count, 0);
  const label = (item: DueItem) => t(`cleanup.item.${item.key}` as AdminKey);

  return (
    <>
      <Card
        title={t('cleanup.title')}
        actions={
          total > 0 && (
            <button type="button" className="adm-btn is-danger is-small" onClick={() => setDeleting(due)}>
              <Trash2 size={15} /> {t('cleanup.deleteAll', { n: formatNumber(total) })}
            </button>
          )
        }
        flush
      >
        <p className="adm-muted adm-small adm-pad adm-cleanup-intro">{t('cleanup.intro')}</p>
        {done !== null && (
          <p className="adm-cleanup-done" role="status">
            <CircleCheck size={16} aria-hidden="true" /> {t('cleanup.done', { n: formatNumber(done) })}
          </p>
        )}
        {failed ? (
          <div className="adm-pad">
            <ErrorNote message={t('common.loadFailed')} onRetry={load} />
          </div>
        ) : !items ? (
          <Loading />
        ) : (
          <>
            {total === 0 && (
              <div className="adm-pad">
                <Empty icon={Archive} title={t('cleanup.none')} body={t('cleanup.noneBody')} />
              </div>
            )}
            <div className="adm-table-wrap">
              <table className="adm-table is-cards adm-cleanup-table">
                <thead>
                  <tr>
                    <th scope="col">{t('cleanup.what')}</th>
                    <th scope="col">{t('cleanup.kept')}</th>
                    <th scope="col" className="is-num">
                      {t('cleanup.due')}
                    </th>
                    <th scope="col">{t('cleanup.oldest')}</th>
                    <th scope="col" className="is-actions">
                      <span className="adm-visually-hidden">{t('common.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.key} className={item.count === 0 ? 'is-quiet' : undefined}>
                      <th scope="row">
                        <span className="adm-cell-title">{label(item)}</span>
                      </th>
                      <td data-label={t('cleanup.kept')}>{t(`cleanup.rule.${item.key}` as AdminKey)}</td>
                      <td className="is-num" data-label={t('cleanup.due')}>
                        {item.count > 0 ? <Badge tone="warn">{formatNumber(item.count)}</Badge> : <span className="adm-muted">0</span>}
                      </td>
                      <td data-label={t('cleanup.oldest')} className="adm-nowrap">
                        {item.oldest ? formatShortDate(item.oldest) : <span className="adm-muted">—</span>}
                      </td>
                      <td className="is-actions">
                        {item.count > 0 && (
                          <div className="adm-row-actions">
                            <button
                              type="button"
                              className="adm-icon-btn is-danger"
                              title={t('cleanup.delete', { what: label(item) })}
                              aria-label={t('cleanup.delete', { what: label(item) })}
                              onClick={() => setDeleting([item])}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {deleting && (
        <ConfirmDialog
          title={t('cleanup.confirmTitle')}
          body={
            <>
              <p>{t('cleanup.confirmBody')}</p>
              <ul className="adm-cleanup-confirm">
                {deleting.map((item) => (
                  <li key={item.key}>
                    {label(item)}: <strong>{formatNumber(item.count)}</strong>
                  </li>
                ))}
              </ul>
            </>
          }
          confirmLabel={t('cleanup.confirm')}
          danger
          busy={busy}
          error={error}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      )}
    </>
  );
}
