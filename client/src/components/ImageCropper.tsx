import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { LoaderCircle, Minus, Plus } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useI18n } from '@/lib/i18n';
import { drawScaled, encodeImage } from '@/lib/images';

export interface CropSpec {
  /** Width / height of the result. */
  aspect: number;
  /** Narrowest crop allowed, in the picture's pixels, so the result stays sharp. */
  minWidth: number;
  /** Widest result: bigger crops are scaled down to this, never up. */
  maxWidth: number;
}

/** The crop, in the picture's pixels: its width and its centre (the height follows from the aspect). */
interface Crop {
  w: number;
  cx: number;
  cy: number;
}

function clampCrop(crop: Crop, width: number, height: number, spec: CropSpec): Crop {
  const widest = Math.min(width, height * spec.aspect);
  const w = Math.min(widest, Math.max(Math.min(spec.minWidth, widest), crop.w));
  const h = w / spec.aspect;
  return {
    w,
    cx: Math.min(width - w / 2, Math.max(w / 2, crop.cx)),
    cy: Math.min(height - h / 2, Math.max(h / 2, crop.cy)),
  };
}

/** The output size for a crop: its own size, or `maxWidth` wide if it's bigger. */
export function outputSize(cropWidth: number, spec: CropSpec) {
  const width = Math.min(Math.round(cropWidth), spec.maxWidth);
  return { width, height: Math.round(width / spec.aspect) };
}

/** The crop at its output size, as high-quality WebP (or lossless PNG; see encodeImage). */
function renderCrop(image: ImageBitmap, crop: Crop, spec: CropSpec): Promise<Blob> {
  const { width, height } = outputSize(crop.w, spec);
  const h = crop.w / spec.aspect;
  return encodeImage(drawScaled(image, crop.cx - crop.w / 2, crop.cy - h / 2, crop.w, h, width, height));
}

/** A round preview of the result, at one of the sizes the site shows it. */
export interface CropPreview {
  size: number;
  label: string;
}

/**
 * A fixed frame in the result's aspect ratio, with the picture under it: drag to position it, and zoom with the
 * wheel, the slider or +/-. It never zooms in past `minWidth` picture pixels, so the result stays sharp.
 * `round`: the result is shown in a circle (profile pictures): the frame shows that circle, and `previews` show
 * the picture as it will look.
 */
export function ImageCropper(props: {
  file: File;
  image: ImageBitmap;
  spec: CropSpec;
  title: string;
  busy: boolean;
  round?: boolean;
  previews?: CropPreview[];
  onCancel: () => void;
  onApply: (image: Blob) => void;
}) {
  const { file, image, spec, busy, round = false, previews = [] } = props;
  const { t } = useI18n();
  const { width: W, height: H } = image;
  const widest = Math.min(W, H * spec.aspect);
  const maxZoom = widest / Math.min(spec.minWidth, widest);
  const [crop, setCrop] = useState<Crop>({ w: widest, cx: W / 2, cy: H / 2 });
  const [frameWidth, setFrameWidth] = useState(0);
  const [rendering, setRendering] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  // Created and revoked in the same effect, so React's dev re-run doesn't leave a revoked URL in place.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    setFrameWidth(frame.clientWidth);
    const observer = new ResizeObserver(() => setFrameWidth(frame.clientWidth));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const frameHeight = frameWidth / spec.aspect;
  const scale = frameWidth / crop.w; // screen pixels per picture pixel

  /** Zooms to a new crop width, keeping the picture point under (px, py) in the frame where it is. */
  const zoom = (toWidth: (w: number) => number, px = frameWidth / 2, py = frameHeight / 2) =>
    setCrop((current) => {
      const s = frameWidth / current.w;
      const pointX = current.cx + (px - frameWidth / 2) / s;
      const pointY = current.cy + (py - frameHeight / 2) / s;
      const w = clampCrop({ ...current, w: toWidth(current.w) }, W, H, spec).w;
      const s2 = frameWidth / w;
      return clampCrop({ w, cx: pointX - (px - frameWidth / 2) / s2, cy: pointY - (py - frameHeight / 2) / s2 }, W, H, spec);
    });
  const pan = (dx: number, dy: number) =>
    setCrop((current) => {
      const s = frameWidth / current.w;
      return clampCrop({ ...current, cx: current.cx - dx / s, cy: current.cy - dy / s }, W, H, spec);
    });

  // The wheel needs a non-passive listener, so zooming doesn't also scroll the page.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !frameWidth) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = frame.getBoundingClientRect();
      zoom((w) => w * Math.exp(event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    pan(event.clientX - drag.current.x, event.clientY - drag.current.y);
    drag.current = { x: event.clientX, y: event.clientY };
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = frameWidth * 0.04;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[event.key]) pan(...moves[event.key]!);
    else if (event.key === '+' || event.key === '=') zoom((w) => w / 1.1);
    else if (event.key === '-') zoom((w) => w * 1.1);
    else return;
    event.preventDefault();
  };

  async function apply() {
    setRendering(true);
    try {
      props.onApply(await renderCrop(image, crop, spec));
    } finally {
      setRendering(false);
    }
  }

  const result = outputSize(crop.w, spec);
  const working = busy || rendering;

  return (
    <Modal title={props.title} onClose={working ? undefined : props.onCancel} className={`crop-modal${round ? ' crop-modal-round' : ''}`}>
      <div className="modal-body">
        <h2>{props.title}</h2>
        <p className="muted small">{t('crop.hint')}</p>
        <div
          ref={frameRef}
          className={`crop-frame${round ? ' is-round' : ''}`}
          style={{ aspectRatio: String(spec.aspect) }}
          tabIndex={0}
          role="application"
          aria-label={t('crop.frame')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={onKeyDown}
        >
          {frameWidth > 0 && url && (
            <img
              src={url}
              alt=""
              draggable={false}
              className="crop-image"
              style={{
                width: W,
                height: H,
                transform: `translate(${frameWidth / 2 - crop.cx * scale}px, ${frameHeight / 2 - crop.cy * scale}px) scale(${scale})`,
              }}
            />
          )}
          {round ? <span className="crop-circle" aria-hidden="true" /> : <span className="crop-grid" aria-hidden="true" />}
        </div>
        <div className="crop-zoom">
          <button type="button" className="icon-btn icon-btn-sm" aria-label={t('crop.zoomOut')} onClick={() => zoom((w) => w * 1.15)} disabled={maxZoom <= 1.001}>
            <Minus size={16} />
          </button>
          <input
            type="range"
            min={1}
            max={maxZoom}
            step={0.001}
            value={widest / crop.w}
            aria-label={t('crop.zoom')}
            disabled={maxZoom <= 1.001}
            onChange={(event) => zoom(() => widest / Number(event.target.value))}
          />
          <button type="button" className="icon-btn icon-btn-sm" aria-label={t('crop.zoomIn')} onClick={() => zoom((w) => w / 1.15)} disabled={maxZoom <= 1.001}>
            <Plus size={16} />
          </button>
        </div>
        {previews.length > 0 && url && (
          <div className="crop-previews" aria-label={t('crop.preview')}>
            <span className="crop-previews-title">{t('crop.preview')}</span>
            <div className="crop-previews-list">
              {previews.map(({ size, label }) => {
                const s = size / crop.w;
                return (
                  <figure key={size} className="crop-preview">
                    <span className="crop-preview-image" style={{ width: size, height: size }}>
                      <img
                        src={url}
                        alt=""
                        draggable={false}
                        className="crop-image"
                        style={{
                          width: W,
                          height: H,
                          transform: `translate(${size / 2 - crop.cx * s}px, ${size / 2 / spec.aspect - crop.cy * s}px) scale(${s})`,
                        }}
                      />
                    </span>
                    <figcaption>{label}</figcaption>
                  </figure>
                );
              })}
            </div>
          </div>
        )}
        <div className="modal-actions crop-actions">
          <span className="muted small">{t('crop.result', { width: result.width, height: result.height })}</span>
          <button type="button" className="btn btn-ghost" onClick={props.onCancel} disabled={working}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void apply()} disabled={working || !frameWidth}>
            {working && <LoaderCircle size={16} className="spin" />} {working ? t('editor.uploading') : t('crop.apply')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
