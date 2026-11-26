import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { CircleCheck, MailWarning, Send } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import type { MailSettings, SmtpSecurity } from '@/admin/types';
import { GeneralSettings, IdentitySettings } from '@/admin/pages/SiteSettings';
import { Card, ErrorNote, Field, Loading, PageHead, Select, Tabs } from '@/admin/ui';
import { useAuth } from '@/context/auth';
import { api, ApiError } from '@/lib/api';

type Tab = 'general' | 'identity' | 'email';
const TABS: Tab[] = ['general', 'identity', 'email'];
/** Tabs that moved to Logs (what the site sent, the old data): their links lead there. */
const MOVED: Record<string, string> = { history: 'emails', cleanup: 'cleanup' };

/**
 * The site's settings, in tabs (kept in the address): its rules, who it is (name, links, logo) and the email server.
 * What it sent and the clean-up of old data are in Logs.
 */
export function SettingsPage() {
  const { t } = useAdminI18n();
  const [params, setParams] = useSearchParams();
  const moved = MOVED[params.get('tab') ?? ''];
  const tab = TABS.find((value) => value === params.get('tab')) ?? 'general';
  if (moved) {
    const next = new URLSearchParams(params);
    next.set('tab', moved);
    return <Navigate to={`/admin/jurnal?${next.toString()}`} replace />;
  }
  return (
    <>
      <PageHead title={t('nav.settings')} subtitle={t('settings.subtitle')} />
      <Tabs<Tab>
        label={t('nav.settings')}
        value={tab}
        onChange={(value) => setParams(value === 'general' ? {} : { tab: value })}
        items={TABS.map((value) => ({ value, label: t(`settings.tab.${value}` as AdminKey) }))}
      />
      {tab === 'general' ? (
        <GeneralSettings />
      ) : tab === 'identity' ? (
        <IdentitySettings />
      ) : (
        <EmailSettings />
      )}
    </>
  );
}

interface MailState {
  settings: MailSettings;
  configured: boolean;
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
    : { tone: 'bad', icon: MailWarning, title: t('mail.off'), body: t('mail.offBody') };

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
