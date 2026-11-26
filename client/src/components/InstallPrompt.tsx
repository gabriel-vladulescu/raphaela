import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Share } from 'lucide-react';
import { site } from '@/config';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';
import { isIOSSafari, promptInstall, useInstallWay } from '@/lib/install';

const VISITS = 'pwa.visits';
const COUNTED = 'pwa.counted'; // per tab session, so a visit counts once
const LATER = 'pwa.laterAt';
const LATER_MS = 30 * 24 * 60 * 60 * 1000;
const DELAY_MS = 20_000;

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

/**
 * From the second visit, after a little reading: offers to add the site to the home screen. Chrome and Edge show
 * their own install dialog (lib/install.ts); on iPhones (Safari) it explains the two taps. Never when already
 * installed, and not again for a month after "Not now". (The account sheet has a button for it any time.)
 */
export function InstallPrompt() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const way = useInstallWay();
  const [eligible, setEligible] = useState(false);
  const [mode, setMode] = useState<'prompt' | 'ios' | null>(null);

  useEffect(() => {
    setEligible(countVisit() >= 2 && !askedRecently());
  }, []);

  // Once the browser offers its dialog (or on an iPhone's Safari), after a little reading; gone once it's done.
  useEffect(() => {
    const offer = way === 'prompt' ? 'prompt' : way === 'ios' && isIOSSafari() ? 'ios' : null;
    if (!eligible || !offer) {
      setMode(null);
      return;
    }
    const timer = window.setTimeout(() => setMode(offer), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [eligible, way]);

  // Not over sign-in and the work pages.
  const shown = mode !== null && !/^\/(login|register|editor|admin)/.test(pathname);
  useEffect(() => {
    if (shown) track('install_shown');
  }, [shown]);
  if (!shown) return null;

  const later = () => {
    store(() => localStorage.setItem(LATER, String(Date.now())), undefined);
    setEligible(false);
    setMode(null);
  };

  const install = async () => {
    const accepted = await promptInstall();
    if (accepted === null) return;
    track(accepted ? 'install_accepted' : 'install_dismissed');
    if (accepted) setMode(null);
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
