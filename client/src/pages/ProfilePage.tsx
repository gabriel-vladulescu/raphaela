import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, ImageUp, LoaderCircle, Trash2, X } from 'lucide-react';
import { AccountCard } from '@/components/AccountCard';
import { AuthorSignature } from '@/components/AuthorSignature';
import { Avatar } from '@/components/Avatar';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { ImageCropper } from '@/components/ImageCropper';
import type { CropSpec } from '@/components/ImageCropper';
import { AlertModal } from '@/components/Modal';
import { useAuth } from '@/context/auth';
import { api, uploadAvatar } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { User } from '@/lib/types';

/** Profile pictures: a square shown round, at least 256 px (sharp on the profile page), kept at up to 512 px. */
const AVATAR: CropSpec = { aspect: 1, minWidth: 256, maxWidth: 512 };

type UsernameProblem = 'username_invalid' | 'username_reserved' | 'username_taken';
type UsernameStatus = 'checking' | 'available' | 'current' | UsernameProblem;

/**
 * A username as it's typed: lowercase, without diacritics, spaces (and hyphens, underscores) become dots, nothing but
 * letters, digits and single dots. A dot at the end stays while typing the next word; the check says if it's left.
 */
function usernameInput(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '.')
    .replace(/[^a-z0-9.]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\./, '');
}

/** Whether the typed username is free: asked 2 seconds after the last key (nothing is shown while typing). */
function useUsernameCheck(value: string, current: string): UsernameStatus | null {
  const [check, setCheck] = useState<{ value: string; status: UsernameStatus } | null>(null);
  useEffect(() => {
    setCheck(null);
    if (!value || value === current) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCheck({ value, status: 'checking' });
      api<{ status: UsernameStatus }>(`/me/username-check?value=${encodeURIComponent(value)}`)
        .then((result) => !cancelled && setCheck({ value, status: result.status }))
        .catch(() => !cancelled && setCheck(null));
    }, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, current]);
  return check?.value === value ? check.status : null;
}

export function ProfilePage() {
  const { user, setUser, canWrite } = useAuth();
  const { t, errorMessage } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  // RequireRole only renders this page for signed-in users.
  const me = user!;
  const [form, setForm] = useState({ name: me.name, username: me.username, occupation: me.occupation ?? '', quote: me.quote ?? '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [picked, setPicked] = useState<{ file: File; image: ImageBitmap } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null);
  const [pictureError, setPictureError] = useState('');

  // Members have one column, in the middle under a centred title; authors also have the preview of their signature.
  const single = !canWrite;
  const usernameStatus = useUsernameCheck(form.username, me.username);
  const usernameProblem: UsernameProblem | null =
    usernameStatus === 'username_invalid' || usernameStatus === 'username_reserved' || usernameStatus === 'username_taken' ? usernameStatus : null;
  const dirty =
    form.name !== me.name || form.username !== me.username || form.occupation !== (me.occupation ?? '') || form.quote !== (me.quote ?? '');

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = canWrite ? form : { name: form.name, username: form.username };
      const { user: updated } = await api<{ user: User }>('/me', { method: 'PATCH', body });
      setUser(updated);
      setForm({ name: updated.name, username: updated.username, occupation: updated.occupation ?? '', quote: updated.quote ?? '' });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // A new picture: big enough, then framed in a circle (ImageCropper) and uploaded.
  async function pickPicture(file: File | undefined) {
    if (!file) return;
    setReading(true);
    let image: ImageBitmap;
    try {
      image = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      setAlert({ title: t('banner.unsupportedTitle'), message: t('banner.unsupported') });
      return;
    } finally {
      setReading(false);
    }
    if (Math.min(image.width, image.height) < AVATAR.minWidth) {
      setAlert({ title: t('banner.tooSmallTitle'), message: t('profile.pictureTooSmall', { width: image.width, height: image.height, min: AVATAR.minWidth }) });
      image.close();
      return;
    }
    setPicked({ file, image });
  }

  function closeCropper() {
    picked?.image.close();
    setPicked(null);
  }

  async function uploadPicture(blob: Blob) {
    setUploading(true);
    setPictureError('');
    try {
      const { user: updated } = await uploadAvatar<{ user: User }>(blob);
      setUser(updated);
      closeCropper();
    } catch (err) {
      // The cropper stays open, so trying again doesn't mean framing it again.
      setAlert({ title: t('banner.uploadFailedTitle'), message: errorMessage(err) });
    } finally {
      setUploading(false);
    }
  }

  async function removePicture() {
    setPictureError('');
    try {
      const { user: updated } = await api<{ user: User }>('/me/avatar', { method: 'DELETE' });
      setUser(updated);
    } catch (err) {
      setPictureError(errorMessage(err));
    }
  }

  return (
    <div className={`container profile-page${single ? ' is-single' : ''}`}>
      <HeaderBackLink />
      <div className="profile-shell">
        <section className="page-hero">
          <div className="page-hero-text">
            <h1>{t('profile.title')}</h1>
            <p className="muted">{t('profile.subtitle')}</p>
          </div>
        </section>

        <div className={`profile-layout${single ? ' is-single' : ''}`}>
          <div className="profile-main">
            <section className="card profile-card profile-picture">
              <Avatar name={me.name} picture={me.picture} size={88} />
              <div className="profile-picture-text">
                <h2 className="side-title">{t('profile.picture')}</h2>
                <p className="muted small">{t('profile.pictureHint', { min: AVATAR.minWidth })}</p>
                <div className="profile-picture-actions">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    hidden
                    onChange={(event) => {
                      void pickPicture(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                  <button type="button" className="btn btn-secondary btn-sm" disabled={reading || uploading} onClick={() => fileRef.current?.click()}>
                    {reading ? <LoaderCircle size={15} className="spin" /> : <ImageUp size={15} />} {t('profile.upload')}
                  </button>
                  {me.hasAvatar && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={removePicture}>
                      <Trash2 size={15} /> {t('profile.removePicture')}
                    </button>
                  )}
                </div>
                {pictureError && <p className="form-error">{pictureError}</p>}
              </div>
            </section>

            <form className="card profile-card profile-form" onSubmit={save}>
              <label className="field">
                <span className="field-label">{t('profile.name')}</span>
                <input className="input" maxLength={80} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">{t('profile.username')}</span>
                <input
                  className={`input${usernameProblem ? ' is-invalid' : ''}`}
                  maxLength={30}
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-describedby="username-status"
                  value={form.username}
                  onChange={(event) => setForm({ ...form, username: usernameInput(event.target.value) })}
                />
                <span
                  id="username-status"
                  className={`field-hint username-status${usernameStatus === 'available' ? ' is-ok' : usernameProblem ? ' is-bad' : ''}`}
                  aria-live="polite"
                >
                  {usernameStatus === 'checking' ? (
                    <>
                      <LoaderCircle size={13} className="spin" aria-hidden="true" /> {t('profile.usernameChecking')}
                    </>
                  ) : usernameStatus === 'available' ? (
                    <>
                      <Check size={14} aria-hidden="true" /> {t('profile.usernameAvailable', { url: `/${form.username}/articole-salvate` })}
                    </>
                  ) : usernameProblem ? (
                    <>
                      <X size={14} aria-hidden="true" /> {t(`error.${usernameProblem}`)}
                    </>
                  ) : (
                    t('profile.usernameHint', { url: `/${form.username || me.username}/articole-salvate` })
                  )}
                </span>
              </label>
              {canWrite && (
                <>
                  <label className="field">
                    <span className="field-label">{t('profile.occupation')}</span>
                    <input
                      className="input"
                      maxLength={80}
                      value={form.occupation}
                      placeholder={t('profile.occupationPlaceholder')}
                      onChange={(event) => setForm({ ...form, occupation: event.target.value })}
                    />
                    <span className="field-hint">{t('profile.occupationHint')}</span>
                  </label>
                  <label className="field">
                    <span className="field-label">{t('profile.quote')}</span>
                    <textarea
                      className="input textarea"
                      rows={3}
                      maxLength={300}
                      value={form.quote}
                      placeholder={t('profile.quotePlaceholder')}
                      onChange={(event) => setForm({ ...form, quote: event.target.value })}
                    />
                    <span className="field-hint">
                      {t('profile.quoteHint')} <span className="profile-count">{form.quote.length}/300</span>
                    </span>
                  </label>
                </>
              )}
              {error && <p className="form-error">{error}</p>}
              <div className="profile-actions">
                {saved && (
                  <span className="saved-indicator">
                    <Check size={15} /> {t('editor.saved')}
                  </span>
                )}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving || !dirty || form.name.trim().length < 2 || form.username.length < 3 || usernameProblem !== null}
                >
                  {saving ? t('common.loading') : t('profile.save')}
                </button>
              </div>
            </form>

            <AccountCard />
          </div>

          {/* Authors see how they appear at the end of their posts, as they type. */}
          {canWrite && (
            <aside className="card profile-preview">
              <h2 className="side-title">{t('profile.preview')}</h2>
              <AuthorSignature
                author={{ name: form.name.trim() || me.name, picture: me.picture, occupation: form.occupation.trim() || null, quote: form.quote.trim() || null }}
              />
            </aside>
          )}
        </div>
      </div>

      {picked && (
        <ImageCropper
          file={picked.file}
          image={picked.image}
          spec={AVATAR}
          round
          previews={[
            { size: 88, label: t('crop.previewProfile') },
            { size: 38, label: t('crop.previewComments') },
            { size: 28, label: t('crop.previewPosts') },
          ]}
          title={t('crop.avatarTitle')}
          busy={uploading}
          onCancel={closeCropper}
          onApply={(blob) => void uploadPicture(blob)}
        />
      )}
      {alert && <AlertModal title={alert.title} message={alert.message} onClose={() => setAlert(null)} />}
    </div>
  );
}
