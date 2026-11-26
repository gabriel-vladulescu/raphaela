import { useState } from 'react';
import type { MouseEvent } from 'react';
import { Check, Copy, Mail, MoreHorizontal, Share2, X } from 'lucide-react';
import { BrandIcon } from '@/components/BrandIcons';
import type { Brand } from '@/components/BrandIcons';
import { Modal } from '@/components/Modal';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';
import type { PostSummary } from '@/lib/types';
import { postPath } from '@/lib/paths';

export interface Shareable {
  /** Absolute address of the page. */
  url: string;
  title: string;
  text: string;
  /** Absolute address of the share image (the banner with the title over it). */
  image: string;
  /** The post, for the statistics and its author's notification (pages other than the post's own, e.g. the feed). */
  postId?: number;
  /** The sheet's heading, when it isn't a post ("Share this post"). */
  heading?: string;
}

/**
 * Whether a phone's share menu takes image files (that's how a picture gets to Instagram). Only on touch screens:
 * desktop browsers can share files too, but there it opens the computer's share dialog, without Instagram.
 */
function canShareImages() {
  try {
    return window.matchMedia('(pointer: coarse)').matches && Boolean(navigator.canShare?.({ files: [new File([''], 'share.jpg', { type: 'image/jpeg' })] }));
  } catch {
    return false;
  }
}

/**
 * Share a post: a bottom sheet on phones, a dialog on wider screens. The apps' own share links, Instagram through the
 * phone's share menu (it has no share link: the picture goes, and the link is copied for a story sticker), copying
 * the link, and the phone's share menu for everything else.
 */
export function ShareSheet({ item, onClose }: { item: Shareable; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const url = encodeURIComponent(item.url);
  const title = encodeURIComponent(item.title);
  const host = new URL(item.url).host;

  const apps: { brand: Exclude<Brand, 'instagram' | 'youtube' | 'tiktok' | 'linkedin'>; label: string; href: string }[] = [
    { brand: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(`${item.title}\n${item.url}`)}` },
    { brand: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${url}` },
    { brand: 'x', label: 'X', href: `https://x.com/intent/post?text=${title}&url=${url}` },
    { brand: 'telegram', label: 'Telegram', href: `https://t.me/share/url?url=${url}&text=${title}` },
    {
      brand: 'pinterest',
      label: 'Pinterest',
      href: `https://www.pinterest.com/pin/create/button/?url=${url}&media=${encodeURIComponent(item.image)}&description=${title}`,
    },
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice(t('share.copyFailed'));
    }
  }

  async function shareImage() {
    setNotice('');
    try {
      await navigator.clipboard.writeText(item.url).catch(() => undefined);
      const blob = await (await fetch(item.image)).blob();
      const file = new File([blob], `${item.title.slice(0, 60)}.jpg`, { type: blob.type || 'image/jpeg' });
      await navigator.share({ files: [file], title: item.title, text: `${item.title}\n${item.url}` });
      setNotice(t('share.instagramHint'));
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') setNotice(t('share.failed'));
    }
  }

  async function shareMore() {
    try {
      await navigator.share({ title: item.title, text: item.text, url: item.url });
      onClose();
    } catch {
      // Closed without sharing.
    }
  }

  return (
    <Modal title={item.heading ?? t('share.title')} onClose={onClose} closeOnBackdrop sheet className="share-sheet">
      <div className="share-head">
        <h2>{item.heading ?? t('share.title')}</h2>
        <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="share-body">

        {/* What the link looks like once shared. */}
        <div className="share-preview">
          <img src={item.image} alt="" width={1200} height={630} />
          <div className="share-preview-text">
            <strong>{item.title}</strong>
            <span>{host}</span>
          </div>
        </div>

        <div className="share-apps">
          {apps.slice(0, 2).map((app) => (
            <a key={app.brand} href={app.href} target="_blank" rel="noopener noreferrer" className={`share-app share-${app.brand}`} onClick={() => track(`share:${app.brand}`, item.postId)}>
              <span className="share-app-icon">
                <BrandIcon brand={app.brand} />
              </span>
              {app.label}
            </a>
          ))}
          {canShareImages() && (
            <button type="button" className="share-app share-instagram" onClick={() => {
              track('share:instagram', item.postId);
              void shareImage();
            }}>
              <span className="share-app-icon">
                <BrandIcon brand="instagram" />
              </span>
              Instagram
            </button>
          )}
          {apps.slice(2).map((app) => (
            <a key={app.brand} href={app.href} target="_blank" rel="noopener noreferrer" className={`share-app share-${app.brand}`} onClick={() => track(`share:${app.brand}`, item.postId)}>
              <span className="share-app-icon">
                <BrandIcon brand={app.brand} />
              </span>
              {app.label}
            </a>
          ))}
          <a href={`mailto:?subject=${title}&body=${encodeURIComponent(`${item.text}\n\n${item.url}`)}`} className="share-app share-email" onClick={() => track('share:email', item.postId)}>
            <span className="share-app-icon">
              <Mail size={22} />
            </span>
            {t('share.email')}
          </a>
        </div>

        <div className="share-copy">
          <span className="share-url" title={item.url}>
            {item.url.replace(/^https?:\/\//, '')}
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => {
              track('share:copy', item.postId);
              void copy();
            }}>
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? t('post.copied') : t('share.copy')}
          </button>
        </div>

        {typeof navigator.share === 'function' && (
          <button type="button" className="btn btn-ghost share-more" onClick={() => {
              track('share:native', item.postId);
              void shareMore();
            }}>
            <MoreHorizontal size={18} /> {t('share.more')}
          </button>
        )}
        {notice && (
          <p className="share-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Opens the share sheet for a page other than a post (a person's list), as a button with its name. */
export function SharePageButton({ item }: { item: Shareable }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Share2 size={16} /> {t('post.share')}
      </button>
      {open && <ShareSheet item={item} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Opens the share sheet for a post (its canonical address and share image). `large`: with its name under the icon
 * (the post's bar and sidebar); otherwise just the icon (the home feed).
 */
export function ShareButton({ post, large }: { post: Pick<PostSummary, 'id' | 'slug' | 'path' | 'title' | 'excerpt' | 'shareImage'>; large?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const absolute = (path: string) => new URL(path, window.location.origin).href;
  return (
    <>
      <button
        type="button"
        className={`reaction-btn${large ? ' reaction-btn-lg' : ''}`}
        aria-haspopup="dialog"
        aria-label={large ? undefined : t('post.share')}
        title={large ? undefined : t('post.share')}
        onClick={(event: MouseEvent) => {
          event.preventDefault(); // inside a card that links to the post
          setOpen(true);
          track('share', post.id);
        }}
      >
        <Share2 size={large ? 20 : 17} />
        {large && <span>{t('post.share')}</span>}
      </button>
      {open && (
        <ShareSheet
          item={{ url: absolute(postPath(post)), title: post.title, text: post.excerpt, image: absolute(post.shareImage), postId: post.id }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
