import { useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react';
import { ImageCropper } from '@/components/ImageCropper';
import type { CropSpec } from '@/components/ImageCropper';
import { AlertModal, ConfirmModal } from '@/components/Modal';
import { uploadImage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** Banners are 16:9 (cards and the post page crop from that). The minimum keeps them sharp across the page. */
const BANNER: CropSpec = { aspect: 16 / 9, minWidth: 1280, maxWidth: 1920 };
const MIN_HEIGHT = Math.round(BANNER.minWidth / BANNER.aspect);

/**
 * Picks a banner: the image must be at least 1280 × 720, then it's framed to 16:9 in a crop dialog, scaled down
 * to at most 1920 × 1080 (the largest the site shows it) if it's bigger, and uploaded (the server stores it as WebP).
 */
export function BannerPicker({ value, onChange }: { value: string | null; onChange: (url: string | null) => void }) {
  const { t, errorMessage } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [picked, setPicked] = useState<{ file: File; image: ImageBitmap } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function pick(file: File | undefined) {
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
    if (image.width < BANNER.minWidth || image.height < MIN_HEIGHT) {
      setAlert({
        title: t('banner.tooSmallTitle'),
        message: t('banner.tooSmall', { width: image.width, height: image.height, minWidth: BANNER.minWidth, minHeight: MIN_HEIGHT }),
      });
      image.close();
      return;
    }
    setPicked({ file, image });
  }

  function closeCropper() {
    picked?.image.close();
    setPicked(null);
  }

  async function upload(blob: Blob) {
    setUploading(true);
    try {
      const name = blob.type === 'image/webp' ? 'banner.webp' : 'banner.png';
      onChange(await uploadImage(new File([blob], name, { type: blob.type })));
      closeCropper();
    } catch (err) {
      // The cropper stays open, so trying again doesn't mean framing it again.
      setAlert({ title: t('banner.uploadFailedTitle'), message: errorMessage(err) });
    } finally {
      setUploading(false);
    }
  }

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
      hidden
      onChange={(event) => {
        void pick(event.target.files?.[0]);
        event.target.value = '';
      }}
    />
  );

  const dialogs = (
    <>
      {picked && (
        <ImageCropper
          file={picked.file}
          image={picked.image}
          spec={BANNER}
          title={t('crop.bannerTitle')}
          busy={uploading}
          onCancel={closeCropper}
          onApply={(blob) => void upload(blob)}
        />
      )}
      {confirmRemove && (
        <ConfirmModal
          title={t('banner.removeTitle')}
          message={t('banner.removeBody')}
          confirmLabel={t('editor.bannerRemove')}
          danger
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            onChange(null);
          }}
        />
      )}
      {alert && <AlertModal title={alert.title} message={alert.message} onClose={() => setAlert(null)} />}
    </>
  );

  if (value) {
    return (
      <div className="banner-preview">
        <img src={value} alt="" />
        <div className="banner-actions">
          <button type="button" className="btn btn-glass btn-sm" onClick={() => input.current?.click()} disabled={reading || uploading}>
            {reading ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} {t('editor.bannerChange')}
          </button>
          <button type="button" className="btn btn-glass btn-sm" onClick={() => setConfirmRemove(true)}>
            <Trash2 size={15} /> {t('editor.bannerRemove')}
          </button>
        </div>
        {fileInput}
        {dialogs}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`banner-drop${dragging ? ' is-dragging' : ''}`}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void pick(event.dataTransfer.files[0]);
        }}
        disabled={reading || uploading}
      >
        {reading ? <LoaderCircle size={26} className="spin" /> : <ImagePlus size={26} />}
        <strong>{t('editor.bannerAdd')}</strong>
        <span className="muted small">{t('editor.bannerHint')}</span>
      </button>
      {fileInput}
      {dialogs}
    </>
  );
}
