import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronDown, CircleCheck, Info, Mail, MailWarning, Send, TriangleAlert } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import type { EmailLog, MailSettings, SiteSettings, SmtpSecurity } from '@/admin/types';
import { GeneralSettings, IdentitySettings } from '@/admin/pages/SiteSettings';
import { Badge, Card, Empty, ErrorNote, Field, LoadMore, Loading, PageHead, SearchBox, Select, Tabs } from '@/admin/ui';
import type { Tone } from '@/admin/ui';
import { useAuth } from '@/context/auth';
import { api, ApiError } from '@/lib/api';

type Tab = 'general' | 'identity' | 'email' | 'history';
const TABS: Tab[] = ['general', 'identity', 'email', 'history'];

/**
 * The site's settings, in tabs (kept in the address): its rules, who it is (name, links, logo), the email server,
 * and what it sent.
 */
export function SettingsPage() {
  const { t } = useAdminI18n();
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((value) => value === params.get('tab')) ?? 'general';
  return (
    <>
      <PageHead title={t('nav.settings')} subtitle={t('settings.subtitle')} />
      <Tabs<Tab>
        label={t('nav.settings')}
        value={tab}
        onChange={(value) => setParams(value === 'general' ? {} : { tab: value })}
        items={TABS.map((value) => ({ value, label: t(`settings.tab.${value}` as AdminKey) }))}
      />
      {tab === 'general' ? <GeneralSettings /> : tab === 'identity' ? <IdentitySettings /> : tab === 'email' ? <EmailSettings /> : <EmailHistory />}
    </>
  );
}

const STATUS_TONE: Record<string, Tone> = { sent: 'good', failed: 'bad', logged: 'info' };
const KINDS = ['verify', 'reset', 'change', 'deleted', 'restored', 'suspended', 'invite', 'newsletter_confirm', 'newsletter_post', 'newsletter_digest', 'test'] as const;
type StatusFilter = 'all' | 'sent' | 'failed' | 'logged';

/** Every email the site tried to send: to whom, what, and whether the server took it (its error if not). */
function EmailHistory() {
  const { t, formatDateTime, formatNumber } = useAdminI18n();
  const [params, setParams] = useSearchParams();
  const status = (['all', 'sent', 'failed', 'logged'] as const).find((value) => value === params.get('status')) ?? 'all';
  const kind = params.get('kind') ?? '';
  const q = params.get('q') ?? '';
  const [data, setData] = useState<EmailLog | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const query = useCallback(
    (offset: number) =>
      `/admin/email-log?offset=${offset}&limit=25${status !== 'all' ? `&status=${status}` : ''}${kind ? `&kind=${kind}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    [status, kind, q],
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
            items={(['all', 'sent', 'failed', 'logged'] as const).map((value) => ({ value, label: t(`emails.status.${value}` as AdminKey), count: data?.counts[value] }))}
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

interface MailState {
  settings: MailSettings;
  configured: boolean;
  production: boolean;
}

/** Well-known servers, to fill the form in one click (the address and password stay the administrator's to type). */
const PRESETS: { name: string; host: string; port: number; security: SmtpSecurity; dailyLimit?: number }[] = [
  { name: 'Gmail', host: 'smtp.gmail.com', port: 465, security: 'tls', dailyLimit: 500 },
  { name: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, security: 'starttls' },
  { name: 'Brevo', host: 'smtp-relay.brevo.com', port: 587, security: 'starttls', dailyLimit: 300 },
  { name: 'Zoho', host: 'smtp.zoho.eu', port: 465, security: 'tls' },
];

/** The SMTP server that sends the account emails, with a test email. */
function EmailSettings() {
  const { t, errorMessage } = useAdminI18n();
  const { user } = useAuth();
  const { refreshOverview } = useAdmin();
  const [state, setState] = useState<MailState | null>(null);
  const [form, setForm] = useState<Omit<MailSettings, 'hasPassword'> & { password: string }>({
    host: '',
    port: 587,
    security: 'starttls',
    user: '',
    password: '',
    fromEmail: '',
    fromName: '',
    dailyLimit: 0,
  });
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [testTo, setTestTo] = useState(user?.email ?? '');
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);

  const apply = (data: MailState) => {
    setState(data);
    setForm({ ...data.settings, password: '' });
  };

  useEffect(() => {
    api<MailState>('/admin/settings/email')
      .then(apply)
      .catch(() => setLoadError(true));
  }, []);

  const set = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setSaved(false);
    setTest(null);
  };
  // The password field left empty keeps the saved one.
  const body = () => ({ ...form, port: Number(form.port), password: form.password ? form.password : undefined });

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      apply(await api<MailState>('/admin/settings/email', { method: 'PUT', body: body() }));
      setSaved(true);
      refreshOverview();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'smtp_from_required' ? t('mail.fromRequired') : errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setTest(null);
    try {
      await api('/admin/settings/email/test', { method: 'POST', body: { to: testTo.trim(), settings: body() } });
      setTest({ ok: true, message: t('mail.testOk', { email: testTo.trim() }) });
    } catch (err) {
      const message = err instanceof ApiError && err.code === 'smtp_failed' ? String(err.data.message ?? '') : err instanceof ApiError && err.code === 'smtp_from_required' ? t('mail.fromRequired') : errorMessage(err);
      setTest({ ok: false, message: t('mail.testFailed', { message }) });
    } finally {
      setTesting(false);
    }
  }

  if (loadError) return <ErrorNote message={t('common.loadFailed')} />;
  if (!state) return <Loading />;

  const status = state.configured
    ? { tone: 'good', icon: CircleCheck, title: t('mail.on'), body: t('mail.onBody', { email: state.settings.fromEmail }) }
    : state.production
      ? { tone: 'bad', icon: MailWarning, title: t('mail.off'), body: t('mail.offBody') }
      : { tone: 'info', icon: Info, title: t('mail.dev'), body: t('mail.devBody') };

  return (
    <>
      <div className={`adm-callout is-${status.tone}`}>
        <status.icon size={18} aria-hidden="true" />
        <div>
          <strong>{status.title}</strong>
          <p>{status.body}</p>
        </div>
      </div>

      <div className="adm-grid is-2-1">
        <Card title={t('mail.title')}>
          <p className="adm-muted adm-small">{t('mail.intro')}</p>
          <div className="adm-chips">
            <span className="adm-muted adm-small">{t('mail.presets')}</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="adm-chip"
                onClick={() => set({ host: preset.host, port: preset.port, security: preset.security, ...(preset.dailyLimit ? { dailyLimit: preset.dailyLimit } : {}) })}
              >
                {preset.name}
              </button>
            ))}
          </div>
          <form className="adm-form" onSubmit={save}>
            <div className="adm-form-row is-3-1">
              <Field label={t('mail.host')} hint={t('mail.hostHint')}>
                <input className="adm-input" value={form.host} placeholder="smtp.example.com" maxLength={255} onChange={(e) => set({ host: e.target.value })} />
              </Field>
              <Field label={t('mail.port')}>
                <input className="adm-input" type="number" min={1} max={65535} value={form.port} onChange={(e) => set({ port: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label={t('mail.security')}>
              <Select<SmtpSecurity>
                block
                label={t('mail.security')}
                value={form.security}
                onChange={(security) => set({ security })}
                options={(['tls', 'starttls', 'none'] as const).map((value) => ({ value, label: t(`mail.security.${value}`) }))}
              />
            </Field>
            <div className="adm-form-row">
              <Field label={t('mail.user')}>
                <input className="adm-input" value={form.user} autoComplete="off" maxLength={255} onChange={(e) => set({ user: e.target.value })} />
              </Field>
              <Field label={t('mail.password')} hint={state.settings.hasPassword ? t('mail.passwordKept') : t('mail.passwordHint')}>
                <input
                  className="adm-input"
                  type="password"
                  value={form.password}
                  autoComplete="new-password"
                  placeholder={state.settings.hasPassword ? '••••••••' : ''}
                  maxLength={500}
                  onChange={(e) => set({ password: e.target.value })}
                />
              </Field>
            </div>
            <Field label={t('mail.dailyLimit')} hint={t('mail.dailyLimitHint')}>
              <input className="adm-input" type="number" min={0} max={1000000} value={form.dailyLimit} onChange={(e) => set({ dailyLimit: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
            <div className="adm-form-row">
              <Field label={t('mail.fromEmail')} hint={t('mail.fromEmailHint')}>
                <input className="adm-input" type="email" value={form.fromEmail} placeholder="contact@raphaela.ro" maxLength={255} onChange={(e) => set({ fromEmail: e.target.value })} />
              </Field>
              <Field label={t('mail.fromName')}>
                <input className="adm-input" value={form.fromName} maxLength={100} onChange={(e) => set({ fromName: e.target.value })} />
              </Field>
            </div>
            {error && <p className="adm-form-error">{error}</p>}
            <div className="adm-form-actions">
              {saved && (
                <span className="adm-saved">
                  <CircleCheck size={15} /> {t('common.saved')}
                </span>
              )}
              <button type="submit" className="adm-btn is-primary" disabled={saving}>
                {saving ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </form>
        </Card>

        <Card title={t('mail.testTitle')}>
          <p className="adm-muted adm-small">{t('mail.testIntro')}</p>
          <Field label={t('mail.testTo')}>
            <input className="adm-input" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          </Field>
          <button type="button" className="adm-btn is-block" disabled={testing || !form.host || !testTo.trim()} onClick={() => void sendTest()}>
            <Send size={15} /> {testing ? t('mail.testing') : t('mail.testSend')}
          </button>
          {test && (
            <p className={`adm-test ${test.ok ? 'is-ok' : 'is-bad'}`} role="status">
              {test.message}
            </p>
          )}
          <h3 className="adm-subtitle">{t('mail.sendsTitle')}</h3>
          <ul className="adm-list">
            <li>{t('mail.sends.verify')}</li>
            <li>{t('mail.sends.reset')}</li>
            <li>{t('mail.sends.change')}</li>
            <li>{t('mail.sends.deleted')}</li>
            <li>{t('mail.sends.restored')}</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
