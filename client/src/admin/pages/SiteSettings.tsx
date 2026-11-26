import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Construction, ImageUp, Megaphone, RotateCcw, TriangleAlert } from 'lucide-react';
import { Dropdown, SearchSelect } from '@/admin/Dropdown';
import { useAdmin } from '@/admin/context';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import { SOCIAL } from '@/admin/types';
import type { SiteIdentity, SiteSettings, Social } from '@/admin/types';
import { Card, ErrorNote, Field, Loading } from '@/admin/ui';
import { api } from '@/lib/api';

/** A switch with its label and hint, saved as it changes. */
function SwitchRow(props: { label: string; hint: ReactNode; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="adm-switch-row">
      <span>
        <strong>{props.label}</strong>
        <span className="adm-muted adm-small">{props.hint}</span>
      </span>
      <input type="checkbox" role="switch" className="adm-switch" checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange(event.target.checked)} />
    </label>
  );
}

/** Save and Undo for a card's text fields (switches save at once). */
function SaveBar(props: { dirty: boolean; busy: boolean; saved: boolean; onSave: () => void; onReset: () => void }) {
  const { t } = useAdminI18n();
  return (
    <div className="adm-save-bar">
      {props.saved && !props.dirty && <span className="adm-muted adm-small">{t('common.saved')}</span>}
      {props.dirty && (
        <button type="button" className="adm-btn is-ghost is-small" onClick={props.onReset} disabled={props.busy}>
          {t('common.undo')}
        </button>
      )}
      <button type="button" className="adm-btn is-primary is-small" onClick={props.onSave} disabled={!props.dirty || props.busy}>
        {props.busy ? t('common.loading') : t('common.save')}
      </button>
    </div>
  );
}

const wordsText = (words: string[]) => words.join('\n');
const parseWords = (text: string) => [...new Set(text.split(/[\n,]/).map((w) => w.trim().toLowerCase()).filter(Boolean))].slice(0, 500);

/**
 * The site's rules (server/src/lib/siteSettings.ts): who can comment and what waits for approval, the announcement
 * above every page, the newsletter, and maintenance (the site closed to everyone but administrators).
 */
export function GeneralSettings() {
  const { t, errorMessage } = useAdminI18n();
  const { refreshOverview } = useAdmin();
  const [state, setState] = useState<{ settings: SiteSettings; mailConfigured: boolean } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // The text fields as typed, saved with their card's button.
  const [words, setWords] = useState('');
  const [announcement, setAnnouncement] = useState<SiteSettings['announcement'] | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');

  useEffect(() => {
    api<NonNullable<typeof state>>('/admin/settings/site')
      .then((loaded) => {
        setState(loaded);
        setWords(wordsText(loaded.settings.blockedWords));
        setAnnouncement(loaded.settings.announcement);
        setMaintenanceMessage(loaded.settings.maintenanceMessage);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function change(patch: Partial<SiteSettings>, part: string) {
    if (!state) return;
    setSaving(part);
    setSaved(null);
    setError('');
    try {
      const { settings } = await api<{ settings: SiteSettings }>('/admin/settings/site', { method: 'PUT', body: { ...state.settings, ...patch } });
      setState({ ...state, settings });
      setSaved(part);
      refreshOverview();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  if (!state || !announcement) return error ? <ErrorNote message={error} /> : <Loading />;
  const s = state.settings;
  const noMail = !state.mailConfigured;
  const wordsDirty = wordsText(parseWords(words)) !== wordsText(s.blockedWords);
  const announcementDirty = JSON.stringify(announcement) !== JSON.stringify(s.announcement);
  const announcementLinkBad = announcement.linkUrl !== '' && !/^(https:\/\/|\/)\S*$/.test(announcement.linkUrl);

  return (
    <div className="adm-settings-stack">
      {error && <p className="adm-form-error">{error}</p>}

      <Card title={t('general.comments')}>
        <SwitchRow
          label={t('general.requireVerified')}
          hint={t('general.requireVerifiedHint')}
          checked={s.commentsRequireVerifiedEmail}
          disabled={saving !== null}
          onChange={(on) => void change({ commentsRequireVerifiedEmail: on }, 'comments')}
        />
        {s.commentsRequireVerifiedEmail && noMail && (
          <p className="adm-callout is-bad adm-small">
            <TriangleAlert size={16} aria-hidden="true" /> {t('general.requireVerifiedNoMail')}
          </p>
        )}
        <SwitchRow
          label={t('general.firstApproval')}
          hint={t('general.firstApprovalHint')}
          checked={s.firstCommentApproval}
          disabled={saving !== null}
          onChange={(on) => void change({ firstCommentApproval: on }, 'comments')}
        />
        <div className="adm-setting">
          <div>
            <strong>{t('general.links')}</strong>
            <span className="adm-muted adm-small">{t('general.linksHint')}</span>
          </div>
          <Dropdown
            label={t('general.links')}
            value={s.links}
            align="end"
            options={(['allow', 'hold', 'block'] as const).map((value) => ({ value, label: t(`general.links.${value}` as AdminKey) }))}
            onChange={(links) => void change({ links }, 'comments')}
          />
        </div>
        <div className="adm-setting is-stacked">
          <div className="adm-setting-head">
            <div>
              <strong>{t('general.words')}</strong>
              <span className="adm-muted adm-small">{t('general.wordsHint')}</span>
            </div>
            <Dropdown
              label={t('general.wordsAction')}
              value={s.blockedWordsAction}
              align="end"
              options={(['hold', 'block'] as const).map((value) => ({ value, label: t(`general.wordsAction.${value}` as AdminKey) }))}
              onChange={(blockedWordsAction) => void change({ blockedWordsAction }, 'comments')}
            />
          </div>
          <textarea className="adm-input adm-textarea" rows={4} value={words} placeholder={t('general.wordsPlaceholder')} onChange={(event) => setWords(event.target.value)} />
          <SaveBar
            dirty={wordsDirty}
            busy={saving === 'words'}
            saved={saved === 'words'}
            onReset={() => setWords(wordsText(s.blockedWords))}
            onSave={() => void change({ blockedWords: parseWords(words) }, 'words').then(() => setWords(wordsText(parseWords(words))))}
          />
        </div>
        <p className="adm-muted adm-small">
          {t('general.heldWhere')} <Link to="/admin/comentarii?filter=held">{t('general.heldLink')}</Link>
        </p>
      </Card>

      <Card title={t('general.announcement')}>
        <SwitchRow
          label={t('general.announcementOn')}
          hint={t('general.announcementHint')}
          checked={s.announcement.enabled}
          disabled={saving !== null || (!s.announcement.text && !announcement.text.trim())}
          onChange={(enabled) => {
            const next = { ...announcement, enabled };
            setAnnouncement(next);
            void change({ announcement: next }, 'announcement');
          }}
        />
        <Field label={t('general.announcementText')}>
          <textarea className="adm-input adm-textarea" rows={2} maxLength={300} value={announcement.text} onChange={(event) => setAnnouncement({ ...announcement, text: event.target.value })} />
        </Field>
        <div className="adm-form-grid">
          <Field label={t('general.announcementLink')} hint={announcementLinkBad ? t('general.announcementLinkBad') : t('general.announcementLinkHint')}>
            <input className="adm-input" maxLength={300} value={announcement.linkUrl} placeholder={t('general.announcementLinkPlaceholder')} onChange={(event) => setAnnouncement({ ...announcement, linkUrl: event.target.value.trim() })} />
          </Field>
          <Field label={t('general.announcementLabel')}>
            <input className="adm-input" maxLength={40} value={announcement.linkLabel} placeholder={t('general.announcementLabelPlaceholder')} onChange={(event) => setAnnouncement({ ...announcement, linkLabel: event.target.value })} />
          </Field>
        </div>
        <div className="adm-setting">
          <strong>{t('general.announcementTone')}</strong>
          <Dropdown
            label={t('general.announcementTone')}
            value={announcement.tone}
            align="end"
            options={(['info', 'success', 'warning'] as const).map((value) => ({ value, label: t(`general.tone.${value}` as AdminKey) }))}
            onChange={(tone) => setAnnouncement({ ...announcement, tone })}
          />
        </div>
        {announcement.text.trim() && (
          <div className={`adm-announcement-preview is-${announcement.tone}`} aria-label={t('general.preview')}>
            <Megaphone size={15} aria-hidden="true" />
            <span>
              {announcement.text} {announcement.linkUrl && <u>{announcement.linkLabel || t('general.announcementLabelPlaceholder')}</u>}
            </span>
          </div>
        )}
        <SaveBar
          dirty={announcementDirty}
          busy={saving === 'announcement'}
          saved={saved === 'announcement'}
          onReset={() => setAnnouncement(s.announcement)}
          onSave={() => {
            if (announcementLinkBad) return;
            const next = { ...announcement, text: announcement.text.trim(), enabled: announcement.enabled && announcement.text.trim() !== '' };
            setAnnouncement(next);
            void change({ announcement: next }, 'announcement');
          }}
        />
      </Card>

      <Card title={t('general.newsletter')}>
        <SwitchRow
          label={t('general.newsletterOn')}
          hint={t('general.newsletterHint')}
          checked={s.newsletterEnabled}
          disabled={saving !== null}
          onChange={(newsletterEnabled) => void change({ newsletterEnabled }, 'newsletter')}
        />
        {s.newsletterEnabled && noMail && (
          <p className="adm-callout is-bad adm-small">
            <TriangleAlert size={16} aria-hidden="true" /> {t('general.newsletterNoMail')}
          </p>
        )}
        <p className="adm-muted adm-small">
          <Link to="/admin/newsletter">{t('general.newsletterLink')}</Link>
        </p>
      </Card>

      <Card title={t('general.maintenance')}>
        <SwitchRow
          label={t('general.maintenanceOn')}
          hint={t('general.maintenanceHint')}
          checked={s.maintenance}
          disabled={saving !== null}
          onChange={(maintenance) => void change({ maintenance, maintenanceMessage: maintenanceMessage.trim() }, 'maintenance')}
        />
        {s.maintenance && (
          <p className="adm-callout is-warn adm-small">
            <Construction size={16} aria-hidden="true" /> {t('general.maintenanceActive')}
          </p>
        )}
        <Field label={t('general.maintenanceMessage')} hint={t('general.maintenanceMessageHint')}>
          <textarea className="adm-input adm-textarea" rows={2} maxLength={500} value={maintenanceMessage} onChange={(event) => setMaintenanceMessage(event.target.value)} />
        </Field>
        <SaveBar
          dirty={maintenanceMessage.trim() !== s.maintenanceMessage}
          busy={saving === 'maintenanceMessage'}
          saved={saved === 'maintenanceMessage'}
          onReset={() => setMaintenanceMessage(s.maintenanceMessage)}
          onSave={() => void change({ maintenanceMessage: maintenanceMessage.trim() }, 'maintenanceMessage')}
        />
      </Card>
    </div>
  );
}

/** The time zones the browser knows (for the site's days, the weekly newsletter's Monday). */
const timeZones = (): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['Europe/Bucharest', 'UTC'];
  } catch {
    return ['Europe/Bucharest', 'UTC'];
  }
};

const SOCIAL_NAMES: Record<Social, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
  linkedin: 'LinkedIn',
};

/**
 * Who the site is (server/src/lib/siteIdentity.ts): its name and description (the pages' titles, search results,
 * shares, the app's name), the company in the footer, the visitors' default language, the time zone its days run
 * in, a contact address and social links (in the footer), and its logo (the icons, the favicon, the share images).
 */
export function IdentitySettings() {
  const { t, errorMessage } = useAdminI18n();
  const [saved, setSavedIdentity] = useState<SiteIdentity | null>(null);
  const [form, setForm] = useState<SiteIdentity | null>(null);
  const [customLogo, setCustomLogo] = useState(false);
  const [logoVersion, setLogoVersion] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const zones = useMemo(timeZones, []);

  useEffect(() => {
    api<{ identity: SiteIdentity; customLogo: boolean }>('/admin/settings/identity')
      .then((data) => {
        setSavedIdentity(data.identity);
        setForm(data.identity);
        setCustomLogo(data.customLogo);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (!form || !saved) return error ? <ErrorNote message={error} /> : <Loading />;
  const set = (patch: Partial<SiteIdentity>) => {
    setForm({ ...form, ...patch });
    setDone(false);
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const badSocial = SOCIAL.filter((key) => form.social[key] && !/^https:\/\/\S+$/.test(form.social[key]));

  async function save() {
    if (!form || badSocial.length) return;
    setBusy(true);
    setError('');
    try {
      const { identity } = await api<{ identity: SiteIdentity }>('/admin/settings/identity', { method: 'PUT', body: form });
      setSavedIdentity(identity);
      setForm(identity);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/admin/settings/logo', { method: 'POST', body });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'request_failed');
      setCustomLogo(true);
      setLogoVersion(Date.now());
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(code === 'logo_too_small' ? t('identity.logoTooSmall') : code === 'image_unreadable' ? t('identity.logoUnreadable') : t('common.actionFailed'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function resetLogo() {
    setBusy(true);
    try {
      await api('/admin/settings/logo', { method: 'DELETE' });
      setCustomLogo(false);
      setLogoVersion(Date.now());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-settings-stack">
      <Card title={t('identity.site')}>
        <div className="adm-form-grid">
          <Field label={t('identity.name')} hint={t('identity.nameHint')}>
            <input className="adm-input" maxLength={60} value={form.name} onChange={(event) => set({ name: event.target.value })} />
          </Field>
          <Field label={t('identity.company')} hint={t('identity.companyHint')}>
            <input className="adm-input" maxLength={80} value={form.company} onChange={(event) => set({ company: event.target.value })} />
          </Field>
        </div>
        <Field label={t('identity.description')} hint={t('identity.descriptionHint')}>
          <textarea className="adm-input adm-textarea" rows={2} maxLength={300} value={form.description} onChange={(event) => set({ description: event.target.value })} />
        </Field>
        <div className="adm-form-grid">
          <div className="adm-field">
            <span className="adm-field-label">{t('identity.defaultLanguage')}</span>
            <Dropdown
              label={t('identity.defaultLanguage')}
              value={form.defaultLanguage}
              block
              options={[
                { value: 'ro', label: 'Română' },
                { value: 'en', label: 'English' },
              ]}
              onChange={(defaultLanguage) =>
                set({ defaultLanguage, language: defaultLanguage, locale: defaultLanguage === 'ro' ? 'ro_RO' : 'en_US' })
              }
            />
            <span className="adm-field-hint">{t('identity.defaultLanguageHint')}</span>
          </div>
          <div className="adm-field">
            <span className="adm-field-label">{t('identity.timeZone')}</span>
            <SearchSelect<string>
              label={t('identity.timeZone')}
              placeholder={form.timeZone}
              searchPlaceholder={t('identity.timeZoneSearch')}
              selected={{ value: form.timeZone, label: form.timeZone }}
              block
              load={async (query, limit) => {
                const q = query.trim().toLowerCase().replace(/\s+/g, '_');
                const found = zones.filter((zone) => zone.toLowerCase().includes(q));
                return { options: found.slice(0, limit).map((zone) => ({ value: zone, label: zone })), hasMore: found.length > limit };
              }}
              onChange={(option) => option && set({ timeZone: option.value })}
            />
            <span className="adm-field-hint">{t('identity.timeZoneHint')}</span>
          </div>
        </div>
        <Field label={t('identity.contact')} hint={t('identity.contactHint')}>
          <input className="adm-input" type="email" maxLength={255} value={form.contactEmail} onChange={(event) => set({ contactEmail: event.target.value.trim() })} />
        </Field>
      </Card>

      <Card title={t('identity.social')}>
        <p className="adm-muted adm-small adm-card-intro">{t('identity.socialHint')}</p>
        <div className="adm-form-grid">
          {SOCIAL.map((key) => (
            <Field key={key} label={SOCIAL_NAMES[key]} hint={badSocial.includes(key) ? t('identity.socialBad') : undefined}>
              <input
                className="adm-input"
                maxLength={300}
                value={form.social[key]}
                placeholder="https://"
                onChange={(event) => set({ social: { ...form.social, [key]: event.target.value.trim() } })}
              />
            </Field>
          ))}
        </div>
      </Card>

      {/* While there's something to save (or just saved, or failed): at the bottom of the screen. */}
      {(dirty || done || error) && (
        <div className="adm-save-bar is-sticky">
          {error && <span className="adm-form-error">{error}</span>}
          {done && !dirty && <span className="adm-muted adm-small">{t('identity.savedNote')}</span>}
          {dirty && (
            <button type="button" className="adm-btn is-ghost" onClick={() => setForm(saved)} disabled={busy}>
              {t('common.undo')}
            </button>
          )}
          <button type="button" className="adm-btn is-primary" disabled={!dirty || busy || !form.name.trim() || badSocial.length > 0} onClick={() => void save()}>
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </div>
      )}

      <Card title={t('identity.logo')}>
        <div className="adm-logo-row">
          <img className="adm-logo-preview" src={`/icons/icon-192.png?v=${logoVersion}`} alt={t('identity.logo')} width={96} height={96} />
          <div>
            <p className="adm-muted adm-small">{t(customLogo ? 'identity.logoCustom' : 'identity.logoDefault')}</p>
            <p className="adm-muted adm-small">{t('identity.logoHint')}</p>
            <div className="adm-row-actions is-start">
              <button type="button" className="adm-btn is-small" disabled={busy} onClick={() => fileRef.current?.click()}>
                <ImageUp size={15} /> {t('identity.logoUpload')}
              </button>
              {customLogo && (
                <button type="button" className="adm-btn is-small is-ghost" disabled={busy} onClick={() => void resetLogo()}>
                  <RotateCcw size={15} /> {t('identity.logoReset')}
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void uploadLogo(event.target.files?.[0])} />
          </div>
        </div>
      </Card>
    </div>
  );
}
