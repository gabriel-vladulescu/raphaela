import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronDown, Mail } from 'lucide-react';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import type { EmailLog } from '@/admin/types';
import { Badge, Card, Empty, ErrorNote, LoadMore, Loading, periodQuery, SearchBox, Select, Tabs } from '@/admin/ui';
import type { Tone } from '@/admin/ui';
import { api } from '@/lib/api';

// Logs → Emails: what the site sent (server/src/routes/admin.ts, /admin/email-log).

const STATUS_TONE: Record<string, Tone> = { sent: 'good', failed: 'bad' };
const KINDS = ['verify', 'reset', 'change', 'deleted', 'restored', 'suspended', 'invite', 'newsletter_confirm', 'newsletter_post', 'support_reply', 'test'] as const;
type StatusFilter = 'all' | 'sent' | 'failed';

/** Every email the site tried to send: to whom, what, and whether the server took it (its error if not). */
export function EmailHistory() {
  const { t, formatDateTime, formatNumber } = useAdminI18n();
  const [params, setParams] = useSearchParams();
  const status = (['all', 'sent', 'failed'] as const).find((value) => value === params.get('status')) ?? 'all';
  const kind = params.get('kind') ?? '';
  const q = params.get('q') ?? '';
  const period = periodQuery(params);
  const [data, setData] = useState<EmailLog | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const query = useCallback(
    (offset: number) =>
      `/admin/email-log?offset=${offset}&limit=25${status !== 'all' ? `&status=${status}` : ''}${kind ? `&kind=${kind}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}${period}`,
    [status, kind, q, period],
  );
  const load = useCallback(() => {
    setFailed(false);
    api<EmailLog>(query(0))
      .then(setData)
      .catch(() => setFailed(true));
  }, [query]);
  useEffect(load, [load]);

  const set = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });

  async function loadMore() {
    if (!data) return;
    setMore(true);
    try {
      const next = await api<EmailLog>(query(data.emails.length));
      setData({ ...next, emails: [...data.emails, ...next.emails] });
    } finally {
      setMore(false);
    }
  }

  const usage = data?.usage;
  const share = usage && usage.dailyLimit > 0 ? Math.min(100, Math.round((usage.sentToday / usage.dailyLimit) * 100)) : null;
  return (
    <>
      {usage && (
        <div className="adm-kpis is-3">
          <div className="adm-kpi">
            <div className="adm-kpi-top">{t('emails.sentToday')}</div>
            <div className="adm-kpi-value">
              {formatNumber(usage.sentToday)}
              {usage.dailyLimit > 0 && <span className="adm-kpi-of"> / {formatNumber(usage.dailyLimit)}</span>}
            </div>
            {share !== null ? (
              <div className={`adm-meter${share >= 80 ? ' is-warn' : ''}`} role="meter" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100} aria-label={t('emails.limitUsed', { n: share })}>
                <div style={{ width: `${share}%` }} />
              </div>
            ) : (
              <span className="adm-muted adm-small">{t('emails.noLimit')}</span>
            )}
          </div>
          <div className="adm-kpi">
            <div className="adm-kpi-top">{t('emails.failedToday')}</div>
            <div className={`adm-kpi-value${usage.failedToday ? ' is-bad' : ''}`}>{formatNumber(usage.failedToday)}</div>
            <span className="adm-muted adm-small">{t('emails.failed24h', { n: usage.failed24h })}</span>
          </div>
          <div className="adm-kpi">
            <div className="adm-kpi-top">{t('emails.total')}</div>
            <div className="adm-kpi-value">{formatNumber(data!.counts.all)}</div>
            <span className="adm-muted adm-small">{t('emails.kept')}</span>
          </div>
        </div>
      )}
      <Card flush>
        <div className="adm-toolbar">
          <Tabs<StatusFilter>
            label={t('emails.status')}
            value={status}
            onChange={(value) => set('status', value === 'all' ? '' : value)}
            items={(['all', 'sent', 'failed'] as const).map((value) => ({ value, label: t(`emails.status.${value}` as AdminKey), count: data?.counts[value] }))}
          />
          <div className="adm-toolbar-row">
            <SearchBox value={q} onChange={(value) => set('q', value)} placeholder={t('emails.search')} />
            <Select<string>
              label={t('emails.kind')}
              value={kind}
              onChange={(value) => set('kind', value)}
              options={[{ value: '', label: t('emails.allKinds') }, ...KINDS.map((value) => ({ value, label: t(`emails.kind.${value}` as AdminKey) }))]}
            />
          </div>
        </div>
        {failed ? (
          <ErrorNote message={t('common.loadFailed')} onRetry={load} />
        ) : !data ? (
          <Loading />
        ) : data.emails.length === 0 ? (
          <div className="adm-pad">
            <Empty icon={Mail} title={t('emails.none')} />
          </div>
        ) : (
          <ul className="adm-emails">
            {data.emails.map((email) => (
              <li key={email.id} className={email.status === 'failed' ? 'is-failed' : undefined}>
                <button type="button" className="adm-email" aria-expanded={open === email.id} onClick={() => setOpen(open === email.id ? null : email.id)}>
                  <Badge tone={STATUS_TONE[email.status] ?? 'neutral'}>{t(`emails.state.${email.status}` as AdminKey)}</Badge>
                  <span className="adm-email-main">
                    <strong>{email.subject}</strong>
                    <span className="adm-muted adm-small">
                      {email.to} · {t(`emails.kind.${email.kind}` as AdminKey)}
                    </span>
                  </span>
                  <time className="adm-muted adm-small adm-nowrap" dateTime={email.createdAt}>
                    {formatDateTime(email.createdAt)}
                  </time>
                  {email.error && <ChevronDown size={15} className="adm-email-chevron" aria-hidden="true" />}
                </button>
                {open === email.id && email.error && <pre className="adm-email-error">{email.error}</pre>}
              </li>
            ))}
          </ul>
        )}
        {data?.hasMore && <LoadMore busy={more} onClick={() => void loadMore()} />}
      </Card>
    </>
  );
}
