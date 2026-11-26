import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { BellRing } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { NewsletterSignup } from '@/components/NewsletterSignup';
import { SUPPORT_HINT } from '@/components/PushToggles';
import { siteSettings } from '@/config';
import { useAuth } from '@/context/auth';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { closeNewsletter, useNewsletterSheet } from '@/lib/newsletterSheet';
import type { NotifyBook } from '@/lib/newsletterSheet';
import { getBookPush, getPushChoices, PushDenied, pushSupport, setBookPush, setPushChoices } from '@/lib/push';

/**
 * "On this device", one switch: a book's new chapters (`book`); else new posts, as a guest's device has them (the
 * bell's switch), or an account's notifications on this device (what it chose to hear about in Settings).
 */
function DeviceWay({ book }: { book?: NotifyBook }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const support = pushSupport();
  const key = user ? 'activity' : 'newPosts';
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (support !== 'ok') return;
    let cancelled = false;
    (book ? getBookPush(book.id) : getPushChoices().then((choices) => choices[key]))
      .then((value) => !cancelled && setOn(value))
      .catch(() => !cancelled && setOn(false));
    return () => {
      cancelled = true;
    };
  }, [book?.id, key, support]);

  async function change(next: boolean) {
    setBusy(true);
    setMessage('');
    try {
      if (book) setOn(await setBookPush(book.id, next));
      else setOn((await setPushChoices({ ...(await getPushChoices()), [key]: next }))[key]);
      if (next) setMessage(t(book ? 'books.notifyDeviceOn' : 'stay.deviceOn'));
    } catch (err) {
      setMessage(t(err instanceof PushDenied ? 'push.denied' : 'error.generic'));
    } finally {
      setBusy(false);
    }
  }

  const hint: MessageKey = support !== 'ok' ? SUPPORT_HINT[support]! : book ? 'books.notifyDeviceHint' : user ? 'stay.deviceHintAccount' : 'stay.deviceHint';
  return (
    <section className="notify-way card" aria-labelledby="notify-device-title">
      <label className="notify-way-head">
        <span className="newsletter-icon" aria-hidden="true">
          <BellRing size={20} />
        </span>
        <span className="notify-way-text">
          <strong id="notify-device-title">{t('stay.device')}</strong>
          <span className="muted small">{t(hint)}</span>
        </span>
        {support === 'ok' && (
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={on === true}
            disabled={busy || on === null}
            onChange={(event) => void change(event.target.checked)}
          />
        )}
      </label>
      {message && (
        <p className="muted small notify-way-status" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

/**
 * A sheet (a dialog on wide screens) for hearing of what's new, opened through lib/newsletterSheet.ts: "Stay in the
 * loop" from the account menu, the same offered at the end of a post (with a "Not now"), and a book's "Notify me"
 * (its new chapters). Two ways, either or both: on this device (push) and by email (the newsletter, while it's on).
 * Closes when the page changes.
 */
export function NewsletterSheet() {
  const state = useNewsletterSheet();
  const { t } = useI18n();
  const { pathname } = useLocation();

  useEffect(() => closeNewsletter, [pathname]);

  if (!state) return null;
  const book = state.way === 'book' ? state.book : undefined;
  const title = book ? t('books.notifyTitle') : t(state.way === 'offer' ? 'newsletter.offerTitle' : 'stay.title');
  const lead = book
    ? t(siteSettings.newsletter ? 'books.notifyLead' : 'books.notifyLeadDevice', { book: book.title })
    : t(siteSettings.newsletter ? 'stay.lead' : 'stay.leadDevice');
  return (
    <Modal title={title} onClose={closeNewsletter} closeOnBackdrop sheet className={`newsletter-sheet${book ? ' book-notify-sheet' : ''}`} head>
      <div className="newsletter-sheet-body notify-ways">
        <p className="notify-ways-lead">{lead}</p>
        <DeviceWay book={book} />
        <NewsletterSignup variant="sheet" keep ways book={book} later={state.way === 'offer' ? closeNewsletter : undefined} />
      </div>
    </Modal>
  );
}
