import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { Share } from 'lucide-react';
import { site } from '@/config';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';

const VISITS = 'pwa.visits';
const COUNTED = 'pwa.counted'; // per tab session, so a visit counts once
const LATER = 'pwa.laterAt';
const LATER_MS = 30 * 24 * 60 * 60 * 1000;
const DELAY_MS = 20_000;

/** Chrome's and Edge's install event. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function store<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** This visit's number (a visit is a browser tab session). */
const countVisit = () =>
  store(() => {
    if (!sessionStorage.getItem(COUNTED)) {
      sessionStorage.setItem(COUNTED, '1');
      localStorage.setItem(VISITS, String(Number(localStorage.getItem(VISITS) ?? 0) + 1));
    }
    return Number(localStorage.getItem(VISITS) ?? 0);
  }, 0);

const askedRecently = () => store(() => Date.now() - Number(localStorage.getItem(LATER) ?? 0) < LATER_MS, true);
const installed = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
/** Safari on an iPhone or iPad: no install prompt there, so it gets the steps instead. */
const iosSafari = () => {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
};

/**
 * From the second visit, after a little reading: offers to add the site to the home screen. Chrome and Edge show
 * their own install dialog; on iPhones it explains the two taps. Never when already installed, and not again for a
 * month after "Not now".
 */
export function InstallPrompt() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [mode, setMode] = useState<'prompt' | 'ios' | null>(null);
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const visit = countVisit();
    if (installed() || visit < 2 || askedRecently()) return;
    let timer = 0;
    const onPrompt = (event: Event) => {
      event.preventDefault(); // shown on our terms, not the browser's mini bar
      deferred.current = event as BeforeInstallPromptEvent;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMode('prompt'), DELAY_MS);
    };
    const onInstalled = () => setMode(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (iosSafari()) timer = window.setTimeout(() => setMode('ios'), DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Not over sign-in and the work pages.
  const shown = mode !== null && !/^\/(login|register|editor|admin)/.test(pathname);
  useEffect(() => {
    if (shown) track('install_shown');
  }, [shown]);
  if (!shown) return null;

  const later = () => {
    store(() => localStorage.setItem(LATER, String(Date.now())), undefined);
    setMode(null);
  };

  const install = async () => {
    const event = deferred.current;
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    track(outcome === 'accepted' ? 'install_accepted' : 'install_dismissed');
    deferred.current = null;
    if (outcome === 'accepted') setMode(null);
    else later();
  };

  const [before, after] = t('install.ios').split('{share}');
  const title = t('install.title', { name: site.name });
  return (
    <div className="install-card" role="dialog" aria-label={title}>
      <img className="install-icon" src="/icons/icon-192.png" alt="" width={44} height={44} />
      <div className="install-text">
        <strong>{title}</strong>
        <span>
          {mode === 'ios' ? (
            <>
              {before}
              <Share size={15} className="install-share" aria-label="Share" />
              {after}
            </>
          ) : (
            t('install.body')
          )}
        </span>
      </div>
      <div className="install-actions">
        {mode === 'prompt' && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void install()}>
            {t('install.action')}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            track('install_dismissed');
            later();
          }}
        >
          {t('install.later')}
        </button>
      </div>
    </div>
  );
}
