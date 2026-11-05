import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CalendarDays, Mail, MailX, Send, Trash2, Users, Zap } from 'lucide-react';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import type { Subscriber } from '@/admin/types';
import { Badge, Card, ConfirmDialog, Empty, ErrorNote, Kpi, LoadMore, Loading, PageHead, SearchBox, Tabs } from '@/admin/ui';
import { api } from '@/lib/api';

const PAGE = 30;
const STATUSES = ['active', 'pending', 'unsubscribed'] as const;
type Status = (typeof STATUSES)[number];

interface SubscriberList {
  subscribers: Subscriber[];
  hasMore: boolean;
  counts: Record<Status | 'instant' | 'weekly', number>;
  enabled: boolean;
  mail: boolean;
}

/**
 * The newsletter (server/src/lib/newsletter.ts): who gets new posts by email, at once or weekly, and who hasn't
 * confirmed yet or stopped. Deleting a subscriber removes their address altogether (a request to be forgotten).
 */
export function NewsletterPage() {
  const { t, formatNumber, formatShortDate } = useAdminI18n();
  const [params, setParams] = useSearchParams();
  const status = (STATUSES.find((s) => s === params.get('status')) ?? 'active') as Status;
  const q = params.get('q') ?? '';
  const [data, setData] = useState<SubscriberList | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [deleting, setDeleting] = useState<Subscriber | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useCallback((offset: number) => `/admin/newsletter?status=${status}&offset=${offset}&limit=${PAGE}${q ? `&q=${encodeURIComponent(q)}` : ''}`, [status, q]);
  const load = useCallback(() => {
    setFailed(false);
    api<SubscriberList>(query(0))
      .then(setData)
      .catch(() => setFailed(true));
  }, [query]);
  useEffect(load, [load]);

  async function loadMore() {
    if (!data) return;
    setMore(true);
    try {
      const next = await api<SubscriberList>(query(data.subscribers.length));
      setData({ ...next, subscribers: [...data.subscribers, ...next.subscribers.filter((s) => !data.subscribers.some((o) => o.id === s.id))] });
    } finally {
      setMore(false);
    }
  }

  const set = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });

  async function remove(subscriber: Subscriber) {
    setBusy(true);
    try {
      await api(`/admin/newsletter/${subscriber.id}`, { method: 'DELETE' });
      setDeleting(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title={t('nav.newsletter')} subtitle={t('newsletter.subtitle')} />
      {data && !data.enabled && (
        <p className="adm-callout is-warn adm-small">
          {t('newsletter.off')} <Link to="/admin/setari">{t('newsletter.toSettings')}</Link>
        </p>
      )}
      {data && data.enabled && !data.mail && <p className="adm-callout is-bad adm-small">{t('newsletter.noMail')}</p>}

      {data && (
        <div className="adm-kpis">
          <Kpi icon={Users} label={t('newsletter.active')} value={formatNumber(data.counts.active)} />
          <Kpi icon={Zap} label={t('newsletter.instant')} value={formatNumber(data.counts.instant)} />
          <Kpi icon={CalendarDays} label={t('newsletter.weekly')} value={formatNumber(data.counts.weekly)} />
          <Kpi icon={MailX} label={t('newsletter.unsubscribed')} value={formatNumber(data.counts.unsubscribed)} />
        </div>
      )}

      <Card flush>
        <div className="adm-toolbar">
          <Tabs<Status>
            label={t('newsletter.filter')}
            value={status}
            onChange={(value) => set('status', value === 'active' ? '' : value)}
            items={STATUSES.map((value) => ({ value, label: t(`newsletter.status.${value}` as AdminKey), count: data?.counts[value] }))}
          />
          <div className="adm-toolbar-row">
            <SearchBox value={q} onChange={(value) => set('q', value)} placeholder={t('newsletter.search')} />
          </div>
        </div>

        {failed ? (
          <ErrorNote message={t('common.loadFailed')} onRetry={load} />
        ) : !data ? (
          <Loading />
        ) : data.subscribers.length === 0 ? (
          <div className="adm-pad">
            <Empty icon={Mail} title={q ? t('newsletter.noneFound') : t('newsletter.none')} body={q ? undefined : t('newsletter.noneBody')} />
          </div>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table is-cards">
              <thead>
                <tr>
                  <th scope="col">{t('newsletter.email')}</th>
                  <th scope="col">{t('newsletter.frequency')}</th>
                  <th scope="col">{t('newsletter.since')}</th>
                  <th scope="col" className="is-num">
                    <Send size={14} aria-label={t('newsletter.received')} />
                  </th>
                  <th scope="col" className="is-actions">
                    <span className="adm-visually-hidden">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.subscribers.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">
                      <span className="adm-cell-title">{s.email}</span>
                      {s.account && <span className="adm-muted adm-small">{t('newsletter.account', { name: s.account })}</span>}
                    </th>
                    <td data-label={t('newsletter.frequency')}>
                      <Badge tone={s.frequency === 'instant' ? 'accent' : 'neutral'}>{t(`newsletter.${s.frequency}` as AdminKey)}</Badge>{' '}
                      <span className="adm-muted adm-small">{s.lang.toUpperCase()}</span>
                    </td>
                    <td data-label={t('newsletter.since')} className="adm-nowrap">
                      {formatShortDate(s.unsubscribedAt ?? s.confirmedAt ?? s.createdAt)}
                    </td>
                    <td className="is-num" data-label={t('newsletter.received')}>
                      {formatNumber(s.received)}
                    </td>
                    <td className="is-actions">
                      <div className="adm-row-actions">
                        <button type="button" className="adm-icon-btn is-danger" title={t('newsletter.delete')} aria-label={t('newsletter.delete')} onClick={() => setDeleting(s)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.hasMore && <LoadMore busy={more} onClick={() => void loadMore()} />}
      </Card>

      {deleting && (
        <ConfirmDialog
          title={t('newsletter.delete')}
          body={t('newsletter.deleteBody', { email: deleting.email })}
          confirmLabel={t('newsletter.delete')}
          danger
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      )}
    </>
  );
}
