import { useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import { site } from '@/config';
import { uploadImage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** What search engines show at most (characters), roughly: longer gets cut. */
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;

interface SeoValue {
  seoTitle: string;
  seoDescription: string;
  socialImageUrl: string | null;
}

/**
 * How the post shows in search results and when shared: a title and a description of its own (otherwise its title
 * and excerpt), and a picture for shares (otherwise the banner). A preview of the search result, with counters.
 */
export function SeoFields(props: {
  value: SeoValue;
  onChange: (patch: Partial<SeoValue>) => void;
  title: string;
  excerpt: string;
  slug: string;
  bannerUrl: string | null;
}) {
  const { t, errorMessage } = useI18n();
  const { value, onChange } = props;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const shownTitle = value.seoTitle.trim() || props.title.trim() || t('editor.titlePlaceholder');
  const shownDescription = value.seoDescription.trim() || props.excerpt.trim();
  const host = typeof window !== 'undefined' ? window.location.host : '';

  async function pick(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      onChange({ socialImageUrl: await uploadImage(file) });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const counter = (length: number, max: number) => (
    <span className={`seo-counter${length > max ? ' is-over' : ''}`}>
      {length}/{max}
    </span>
  );

  return (
    <div className="seo-fields">
      <div className="seo-preview" aria-label={t('editor.seoPreview')}>
        <span className="seo-preview-site">
          {site.name} · {host}/posts/{props.slug || '…'}
        </span>
        <span className="seo-preview-title">{shownTitle.length > TITLE_MAX + 5 ? `${shownTitle.slice(0, TITLE_MAX)}…` : shownTitle}</span>
        <span className="seo-preview-description">
          {shownDescription ? (shownDescription.length > DESCRIPTION_MAX + 5 ? `${shownDescription.slice(0, DESCRIPTION_MAX)}…` : shownDescription) : t('editor.seoNoDescription')}
        </span>
      </div>

      <label className="field">
        <span className="field-label seo-label">
          {t('editor.seoTitle')} {counter(value.seoTitle.length, TITLE_MAX)}
        </span>
        <input className="input" maxLength={200} value={value.seoTitle} placeholder={props.title} onChange={(event) => onChange({ seoTitle: event.target.value })} />
      </label>
      <label className="field">
        <span className="field-label seo-label">
          {t('editor.seoDescription')} {counter(value.seoDescription.length, DESCRIPTION_MAX)}
        </span>
        <textarea
          className="input textarea"
          rows={3}
          maxLength={300}
          value={value.seoDescription}
          placeholder={props.excerpt}
          onChange={(event) => onChange({ seoDescription: event.target.value })}
        />
        <span className="field-hint">{t('editor.seoHint')}</span>
      </label>

      <div className="field">
        <span className="field-label">{t('editor.socialImage')}</span>
        <div className="social-image">
          <span className="social-image-frame">
            {value.socialImageUrl || props.bannerUrl ? <img src={value.socialImageUrl ?? props.bannerUrl ?? ''} alt="" /> : <span className="muted small">{t('editor.socialImageNone')}</span>}
          </span>
          <span className="social-image-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <LoaderCircle size={15} className="spin" /> : <ImagePlus size={15} />} {t(value.socialImageUrl ? 'editor.socialImageChange' : 'editor.socialImagePick')}
            </button>
            {value.socialImageUrl && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ socialImageUrl: null })}>
                <Trash2 size={15} /> {t('editor.socialImageRemove')}
              </button>
            )}
          </span>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => void pick(event.target.files?.[0])} />
        <span className="field-hint">{t(value.socialImageUrl ? 'editor.socialImageHint' : 'editor.socialImageBanner')}</span>
        {error && <p className="form-error small">{error}</p>}
      </div>
    </div>
  );
}
