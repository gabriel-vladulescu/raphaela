import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent, FormEvent, KeyboardEvent } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, ImagePlus, ImageUp, LoaderCircle, Search, TriangleAlert, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { ApiError, fetchImage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  BANNER_MIN,
  creditOf,
  droppedImageUrl,
  googleImagesUrl,
  looksLikeUrl,
  searchOpenverse,
  searchWikimedia,
  SearchLimited,
  webImage,
} from '@/lib/imageSearch';
import type { FoundImage } from '@/lib/imageSearch';

/** Who made a banner and its licence (shown under it), and the page it links to. */
export interface ImageCredit {
  text: string;
  url: string | null;
}

type Library = 'wikimedia' | 'openverse';
type Tab = Library | 'google';
const TABS: Tab[] = ['wikimedia', 'openverse', 'google'];

interface Results {
  query: string;
  images: FoundImage[];
  /** Where the next page starts; null: no more. */
  next: number | null;
  loading: boolean;
  error: 'failed' | 'limited' | null;
}

const searchIn = (library: Library, query: string, from?: number) =>
  library === 'wikimedia' ? searchWikimedia(query, from ?? 0) : searchOpenverse(query, from ?? 1);

/** Google's small previews (what's copied or dragged from its results page), not the image itself. */
const isGoogleThumb = (url: string) => url.startsWith('data:') || /^https:\/\/encrypted-tbn\d*\.gstatic\.com\//.test(url);

/**
 * Where a banner comes from: a dialog (the whole screen on phones) with two choices, uploading one from the device
 * or searching for one. The search takes the whole screen: free image libraries searched right here (Wikimedia
 * Commons, Openverse; their credit is kept with the banner), and Google Images, which only opens in its own tab
 * (it can't be shown inside another site): an image found there is brought back by its address, or dragged in.
 * A picked image goes to `onPick` (framed over this dialog; BannerPicker closes it once the banner is uploaded).
 */
export function ImageSourceDialog({ onPick, onClose }: { onPick: (file: File, credit: ImageCredit | null) => void; onClose: () => void }) {
  const { t, errorMessage } = useI18n();
  const [view, setView] = useState<'choose' | 'search'>('choose');
  const [tab, setTab] = useState<Tab>('wikimedia');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Record<Library, Results | null>>({ wikimedia: null, openverse: null });
  const latest = useRef(results);
  useEffect(() => {
    latest.current = results;
  });
  /** Results whose small image doesn't load (Openverse sometimes can't make one): left out. */
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const [viewing, setViewing] = useState<FoundImage | null>(null);
  const [natural, setNatural] = useState<{ id: string; width: number; height: number } | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  /** The image being downloaded (to be chosen), and why the last one couldn't be. */
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const files = useRef(new Map<string, File>());
  /** Downloaded web images are shown from here (their own site may not let them show elsewhere). */
  const [local, setLocal] = useState<Record<string, string>>({});
  const [address, setAddress] = useState('');
  const [addressError, setAddressError] = useState('');
  const [freeOnly, setFreeOnly] = useState(true);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const searchOption = useRef<HTMLButtonElement>(null);

  const objectUrls = useRef<string[]>([]);
  useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const current = tab === 'google' ? null : results[tab];
  const shown = current?.images.filter((image) => !broken.has(image.id)) ?? [];

  async function run(library: Library, text: string, more = false) {
    const before = latest.current[library];
    if (more && (!before || before.loading || before.next === null || before.query !== text)) return;
    setResults((all) => ({
      ...all,
      [library]: { query: text, images: more ? all[library]!.images : [], next: more ? all[library]!.next : null, loading: true, error: null },
    }));
    try {
      const page = await searchIn(library, text, more ? before!.next! : undefined);
      setResults((all) => {
        const now = all[library];
        if (!now || now.query !== text) return all; // searched for something else meanwhile
        const seen = new Set(now.images.map((image) => image.id));
        return {
          ...all,
          [library]: { ...now, images: [...now.images, ...page.images.filter((image) => !seen.has(image.id))], next: page.next, loading: false },
        };
      });
    } catch (err) {
      setResults((all) => {
        const now = all[library];
        if (!now || now.query !== text) return all;
        return { ...all, [library]: { ...now, loading: false, error: err instanceof SearchLimited ? 'limited' : 'failed' } };
      });
    }
  }

  // More results as the end of the list comes into view.
  useEffect(() => {
    const end = sentinel.current;
    if (tab === 'google' || !end || !current || current.loading || current.error || current.next === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void run(tab, current.query, true);
      },
      { root: scroller.current, rootMargin: '600px 0px' },
    );
    observer.observe(end);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `run` reads the latest results itself
  }, [tab, current]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    if (looksLikeUrl(text)) {
      void openWeb(text);
      return;
    }
    if (tab === 'google') {
      window.open(googleImagesUrl(text, freeOnly), '_blank', 'noopener');
      return;
    }
    scroller.current?.scrollTo({ top: 0 });
    void run(tab, text);
  }

  function switchTab(next: Tab) {
    setTab(next);
    const text = query.trim();
    if (next !== 'google' && text && !looksLikeUrl(text) && results[next]?.query !== text) void run(next, text);
  }

  function open(image: FoundImage) {
    if (!viewing) returnFocus.current = document.activeElement as HTMLElement | null;
    setViewing(image);
    setFailure(null);
  }

  function closeViewer() {
    setViewing(null);
    setFailure(null);
    requestAnimationFrame(() => returnFocus.current?.focus());
  }

  /** The image as a file (downloaded by the server: browsers can't read other sites' images), or null if it can't be. */
  async function download(image: FoundImage): Promise<File | null> {
    const known = files.current.get(image.id);
    if (known) return known;
    setBusy(image.id);
    setFailure(null);
    try {
      const file = image.full.startsWith('data:') ? await dataFile(image.full) : await fetchImage(image.full);
      files.current.set(image.id, file);
      return file;
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setFailure({ id: image.id, message: code === 'file_type' ? t('imageSource.notImage') : errorMessage(err) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function choose(image: FoundImage) {
    const file = await download(image);
    if (!file) return;
    const credit = creditOf(image);
    onPick(file, credit.text ? credit : null);
  }

  /** An image's address (pasted, dragged, or typed in the search box): downloaded first, to show it and its size. */
  async function openWeb(raw: string) {
    const image = webImage(raw);
    if (!looksLikeUrl(image.full)) {
      setAddressError(t('error.image_url_invalid'));
      return;
    }
    setAddressError('');
    open(image);
    const file = await download(image);
    if (file && !local[image.id]) {
      const url = URL.createObjectURL(file);
      objectUrls.current.push(url);
      setLocal((all) => ({ ...all, [image.id]: url }));
    }
  }

  function takeFile(file: File | undefined) {
    if (file && file.type.startsWith('image/')) onPick(file, null);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDropping(false);
    if (event.dataTransfer.files.length > 0) return takeFile(event.dataTransfer.files[0]);
    const url = droppedImageUrl(event.dataTransfer);
    if (url) void openWeb(url);
    else setAddressError(t('imageSource.dropNothing'));
  }

  // Pasting an image (copied in another tab) or its address, anywhere but in a text box.
  function onPaste(event: ClipboardEvent) {
    if (view !== 'search' || (event.target as HTMLElement).closest('input, textarea')) return;
    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith('image/'));
    if (file) {
      event.preventDefault();
      takeFile(file);
      return;
    }
    const text = event.clipboardData.getData('text/plain').trim();
    if (looksLikeUrl(text)) {
      event.preventDefault();
      void openWeb(text);
    }
  }

  /** Escape and the back button: one step back (the image, the search, then the dialog). */
  function back() {
    if (viewing) closeViewer();
    else if (view === 'search') {
      setView('choose');
      requestAnimationFrame(() => searchOption.current?.focus());
    } else onClose();
  }

  const index = viewing ? shown.findIndex((image) => image.id === viewing.id) : -1;
  const step = (by: number) => {
    const next = shown[index + by];
    if (next) open(next);
  };
  const onViewerKey = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input')) return;
    if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
  };

  const hiddenInput = (
    <input
      ref={fileInput}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
      hidden
      onChange={(event) => {
        takeFile(event.target.files?.[0]);
        event.target.value = '';
      }}
    />
  );

  if (view === 'choose') {
    return (
      <Modal title={t('imageSource.title')} onClose={back} closeOnBackdrop className="image-source">
        <div className="modal-body isrc-choose">
          <div className="isrc-head">
            <h2>{t('imageSource.title')}</h2>
            <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
              <X size={20} />
            </button>
          </div>
          <p className="muted">{t('imageSource.intro', { width: BANNER_MIN.width, height: BANNER_MIN.height })}</p>
          <div className="isrc-options">
            <button type="button" className="isrc-option" onClick={() => fileInput.current?.click()}>
              <span className="isrc-option-icon">
                <ImageUp size={24} />
              </span>
              <span className="isrc-option-text">
                <strong>{t('imageSource.upload')}</strong>
                <span className="muted small">{t('imageSource.uploadHint')}</span>
              </span>
            </button>
            <button ref={searchOption} type="button" className="isrc-option" onClick={() => setView('search')}>
              <span className="isrc-option-icon">
                <Search size={24} />
              </span>
              <span className="isrc-option-text">
                <strong>{t('imageSource.search')}</strong>
                <span className="muted small">{t('imageSource.searchHint')}</span>
              </span>
            </button>
          </div>
          {hiddenInput}
        </div>
      </Modal>
    );
  }

  // A library says how big the original is (what's shown is a smaller copy); a web image is measured once it's here.
  const viewedSize =
    viewing?.width && viewing.height ? { width: viewing.width, height: viewing.height } : viewing && natural?.id === viewing.id ? natural : null;
  const tooSmall = viewedSize !== null && (viewedSize.width < BANNER_MIN.width || viewedSize.height < BANNER_MIN.height);
  const viewedSrc = viewing ? (viewing.source === 'web' ? local[viewing.id] : viewing.preview) : undefined;

  return (
    <Modal title={t('imageSource.search')} onClose={back} className="image-source is-search">
      <div className={`isrc-search${dropping ? ' is-dropping' : ''}`} onPaste={onPaste}>
        <div className="isrc-bar">
          <button type="button" className="icon-btn" aria-label={viewing ? t('imageSource.backToResults') : t('imageSource.back')} onClick={back}>
            <ArrowLeft size={20} />
          </button>
          <form className="isrc-form" role="search" onSubmit={submit}>
            <div className="isrc-field">
              <Search size={18} className="isrc-field-icon" aria-hidden="true" />
              <input
                className="input"
                type="text"
                inputMode="search"
                enterKeyHint="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('imageSource.placeholder')}
                aria-label={t('imageSource.placeholder')}
                maxLength={2000}
                autoFocus
              />
              {query && (
                <button type="button" className="icon-btn icon-btn-sm isrc-clear" aria-label={t('imageSource.clear')} onClick={() => setQuery('')}>
                  <X size={16} />
                </button>
              )}
            </div>
            <button type="submit" className="btn btn-primary isrc-go" disabled={!query.trim()} aria-label={t('imageSource.submit')}>
              {tab === 'google' && !looksLikeUrl(query) ? <ExternalLink size={16} /> : <Search size={16} />}
              <span>{t('imageSource.submit')}</span>
            </button>
          </form>
        </div>

        <div className="isrc-body">
          <div className="tabs isrc-tabs" role="tablist" aria-label={t('imageSource.where')}>
            {TABS.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className={`tab${tab === value ? ' is-selected' : ''}`}
                onClick={() => switchTab(value)}
              >
                <span className="isrc-tab-full">{t(`imageSource.${value}`)}</span>
                <span className="isrc-tab-short" aria-hidden="true">
                  {t(`imageSource.${value}Short`)}
                </span>
              </button>
            ))}
          </div>

          <div ref={scroller} className="isrc-scroll" role="tabpanel">
            {tab === 'google' ? (
              <div className="isrc-google">
                <p>{t('imageSource.googleIntro')}</p>
                <div className="isrc-google-open">
                  <a className="btn btn-primary" href={googleImagesUrl(query.trim(), freeOnly)} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={16} />{' '}
                    {query.trim() && !looksLikeUrl(query) ? t('imageSource.googleSearch', { q: query.trim() }) : t('imageSource.googleOpen')}
                  </a>
                  <label className="isrc-check">
                    <input type="checkbox" checked={freeOnly} onChange={(event) => setFreeOnly(event.target.checked)} />
                    {t('imageSource.googleFree')}
                  </label>
                </div>
                <ol className="isrc-steps">
                  <li>{t('imageSource.googleStep1')}</li>
                  <li>{t('imageSource.googleStep2')}</li>
                  <li>{t('imageSource.googleStep3')}</li>
                </ol>
                <form
                  className="isrc-address"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (address.trim()) void openWeb(address);
                  }}
                >
                  <label className="field-label" htmlFor="isrc-address">
                    {t('imageSource.address')}
                  </label>
                  <div className="isrc-address-row">
                    <input
                      id="isrc-address"
                      className={`input${addressError ? ' is-invalid' : ''}`}
                      type="url"
                      inputMode="url"
                      value={address}
                      placeholder="https://…"
                      onChange={(event) => {
                        setAddress(event.target.value);
                        setAddressError('');
                      }}
                      aria-describedby={addressError ? 'isrc-address-error' : undefined}
                    />
                    <button type="submit" className="btn btn-glass" disabled={!address.trim()}>
                      {t('imageSource.addressOpen')}
                    </button>
                  </div>
                  {addressError && (
                    <p id="isrc-address-error" className="form-error" role="alert">
                      {addressError}
                    </p>
                  )}
                </form>
                <div
                  className="isrc-drop"
                  tabIndex={0}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDropping(true);
                  }}
                  onDragLeave={() => setDropping(false)}
                  onDrop={onDrop}
                >
                  <ImagePlus size={24} aria-hidden="true" />
                  <span>{t('imageSource.drop')}</span>
                </div>
                <p className="isrc-warning">
                  <TriangleAlert size={16} aria-hidden="true" />
                  <span>{t('imageSource.copyright')}</span>
                </p>
              </div>
            ) : (
              <>
                <p className="isrc-note muted small">{t(`imageSource.${tab}Note`)}</p>
                {!current ? (
                  <div className="isrc-empty">
                    <Search size={30} aria-hidden="true" />
                    <p>{t('imageSource.start', { width: BANNER_MIN.width, height: BANNER_MIN.height })}</p>
                  </div>
                ) : (
                  <>
                    {shown.length > 0 && (
                      <ul className="isrc-grid">
                        {shown.map((image) => (
                          <li key={image.id}>
                            <button
                              type="button"
                              className="isrc-tile"
                              onClick={() => open(image)}
                              aria-label={image.title || t('imageSource.untitled')}
                              title={image.title}
                            >
                              <img
                                src={image.thumb}
                                alt=""
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                onError={() => setBroken((all) => new Set(all).add(image.id))}
                              />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {current.loading ? (
                      <div className="isrc-status" role="status">
                        <LoaderCircle size={22} className="spin" aria-hidden="true" /> {t('imageSource.searching')}
                      </div>
                    ) : current.error ? (
                      <div className="isrc-status" role="alert">
                        <span>{current.error === 'limited' ? t('imageSource.limited') : t('imageSource.failed', { source: t(`imageSource.${tab}`) })}</span>
                        <button type="button" className="btn btn-glass btn-sm" onClick={() => void run(tab, current.query, current.images.length > 0)}>
                          {t('imageSource.retry')}
                        </button>
                      </div>
                    ) : shown.length === 0 ? (
                      <div className="isrc-empty">
                        <p>{t('imageSource.empty', { q: current.query })}</p>
                      </div>
                    ) : current.next !== null ? (
                      <div className="isrc-status">
                        <button type="button" className="btn btn-glass btn-sm" onClick={() => void run(tab, current.query, true)}>
                          {t('imageSource.more')}
                        </button>
                      </div>
                    ) : null}
                    <div ref={sentinel} aria-hidden="true" />
                  </>
                )}
              </>
            )}
          </div>

          {viewing && (
            <div className="isrc-viewer" role="group" aria-label={viewing.title || t('imageSource.untitled')} onKeyDown={onViewerKey}>
              <div className="isrc-stage">
                {viewing.source !== 'web' && <img className="isrc-stage-thumb" src={viewing.thumb} alt="" referrerPolicy="no-referrer" />}
                {viewedSrc && (
                  <img
                    key={viewedSrc}
                    className={`isrc-stage-image${loaded === viewing.id ? ' is-loaded' : ''}`}
                    src={viewedSrc}
                    alt={viewing.title}
                    referrerPolicy="no-referrer"
                    onLoad={(event) => {
                      setLoaded(viewing.id);
                      setNatural({ id: viewing.id, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
                    }}
                  />
                )}
                {loaded !== viewing.id && !(failure?.id === viewing.id) && <LoaderCircle size={30} className="spin isrc-stage-spinner" aria-hidden="true" />}
                {index > 0 && (
                  <button type="button" className="isrc-step is-prev" aria-label={t('imageSource.prev')} onClick={() => step(-1)}>
                    <ChevronLeft size={24} />
                  </button>
                )}
                {index >= 0 && index < shown.length - 1 && (
                  <button type="button" className="isrc-step is-next" aria-label={t('imageSource.next')} onClick={() => step(1)}>
                    <ChevronRight size={24} />
                  </button>
                )}
              </div>
              <div className="isrc-info">
                <div className="isrc-info-text">
                  {viewing.title && <strong>{viewing.title}</strong>}
                  {viewing.source !== 'web' && (
                    <span className="muted small">{[viewing.author ?? t('imageSource.unknownAuthor'), viewing.license].filter(Boolean).join(' · ')}</span>
                  )}
                  <span className="muted small isrc-info-meta">
                    {viewedSize && t('imageSource.size', { width: viewedSize.width, height: viewedSize.height })}
                    {viewing.page && (
                      <a href={viewing.page} target="_blank" rel="noopener noreferrer">
                        {t('imageSource.page')} <ExternalLink size={12} />
                      </a>
                    )}
                  </span>
                  {viewing.source === 'web' && isGoogleThumb(viewing.full) ? (
                    <p className="isrc-warning">
                      <TriangleAlert size={16} aria-hidden="true" />
                      <span>{t('imageSource.googleThumb')}</span>
                    </p>
                  ) : tooSmall ? (
                    <p className="isrc-warning">
                      <TriangleAlert size={16} aria-hidden="true" />
                      <span>{t('imageSource.tooSmall', { width: BANNER_MIN.width, height: BANNER_MIN.height })}</span>
                    </p>
                  ) : (
                    viewing.source === 'web' && (
                      <p className="isrc-warning">
                        <TriangleAlert size={16} aria-hidden="true" />
                        <span>{t('imageSource.copyright')}</span>
                      </p>
                    )
                  )}
                  {failure?.id === viewing.id && (
                    <p className="form-error" role="alert">
                      {failure.message}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-primary isrc-choose-btn"
                  onClick={() => void choose(viewing)}
                  disabled={busy !== null || tooSmall || (viewing.source === 'web' && !local[viewing.id])}
                  autoFocus
                >
                  {busy === viewing.id ? <LoaderCircle size={16} className="spin" /> : <ImagePlus size={16} />}{' '}
                  {busy === viewing.id ? t('imageSource.downloading') : t('imageSource.choose')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** A data: address (an image dragged straight from a page) as a file. */
async function dataFile(url: string): Promise<File> {
  const blob = await (await fetch(url)).blob();
  if (!blob.type.startsWith('image/')) throw new ApiError('file_type', 400);
  return new File([blob], `image.${blob.type.replace(/^image\//, '').replace('jpeg', 'jpg')}`, { type: blob.type });
}
