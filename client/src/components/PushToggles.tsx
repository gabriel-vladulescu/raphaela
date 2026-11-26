import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { getPushChoices, PushDenied, pushSupport, setPushChoices } from '@/lib/push';
import type { PushChoices } from '@/lib/push';

/** Why a device can't get push notifications, in words. */
export const SUPPORT_HINT: Record<string, MessageKey> = {
  insecure: 'push.insecure',
  'ios-install': 'push.ios',
  unsupported: 'push.unsupported',
};

/**
 * Push notifications on this device, one switch: `guest` (signed out, the bell's panel), new posts; `account`
 * (Settings), everything the account gets in Notifications, with a test once it's on. Where the device can't get
 * them, it says why.
 */
export function PushToggles({ mode }: { mode: 'guest' | 'account' }) {
  const { t } = useI18n();
  const support = pushSupport();
  const [choices, setChoices] = useState<PushChoices | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const key: keyof PushChoices = mode === 'guest' ? 'newPosts' : 'activity';

  useEffect(() => {
    if (support !== 'ok') return;
    let cancelled = false;
    getPushChoices()
      .then((current) => !cancelled && setChoices(current))
      .catch(() => !cancelled && setChoices({ newPosts: false, activity: false }));
    return () => {
      cancelled = true;
    };
  }, [support]);

  if (support !== 'ok') return <p className="muted small push-hint">{t(SUPPORT_HINT[support]!)}</p>;
  if (!choices) return null;

  async function change(on: boolean) {
    setBusy(true);
    setMessage('');
    try {
      setChoices(await setPushChoices({ ...choices!, [key]: on }));
    } catch (err) {
      setMessage(t(err instanceof PushDenied ? 'push.denied' : 'error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setMessage('');
    try {
      await api('/push/test', { method: 'POST' });
      setMessage(t('push.testSent'));
    } catch {
      setMessage(t('error.generic'));
    }
  }

  return (
    <div className="push-toggles">
      <label className="switch-field">
        <span className="switch-text">
          <strong>{t(mode === 'guest' ? 'push.newPosts' : 'push.activity')}</strong>
          <span className="field-hint">{t(mode === 'guest' ? 'push.newPostsHint' : 'push.activityHint')}</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={choices[key]} disabled={busy} onChange={(event) => void change(event.target.checked)} />
      </label>
      {mode === 'account' && choices.activity && (
        <button type="button" className="btn btn-ghost btn-sm push-test" onClick={() => void test()}>
          {t('push.test')}
        </button>
      )}
      {message && (
        <p className="muted small" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
