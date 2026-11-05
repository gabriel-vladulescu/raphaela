import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Trash2, TriangleAlert } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { showToast } from '@/lib/toast';

/** How long a deleted account is kept before it's gone for good (server/src/lib/accounts.ts). */
const RETENTION_MONTHS = 3;

/**
 * Profile, at the end: deleting the account. A dialog says what happens (signed out, kept 3 months so support can
 * restore it, then gone) and asks to confirm, with the password when the account has one. Administrators can't.
 */
export function DeleteAccountCard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user || user.role === 'owner') return null;

  return (
    <section className="card profile-card danger-card">
      <h2 className="side-title">{t('deleteAccount.title')}</h2>
      <p className="muted small">{t('deleteAccount.hint', { months: RETENTION_MONTHS })}</p>
      <div className="profile-actions">
        <button type="button" className="btn btn-danger-ghost" onClick={() => setOpen(true)}>
          <Trash2 size={16} /> {t('deleteAccount.open')}
        </button>
      </div>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </section>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { t, lang, errorMessage, formatDate } = useI18n();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const me = user!;
  const [password, setPassword] = useState('');
  const [comments, setComments] = useState<Choice | null>(null);
  /** Whether they have posts (then they choose for them too); null while it's asked. */
  const [hasPosts, setHasPosts] = useState<boolean | null>(null);
  const [posts, setPosts] = useState<Choice | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ hasPosts: boolean }>('/me/deletion')
      .then((result) => setHasPosts(result.hasPosts))
      .catch(() => setHasPosts(false));
  }, []);

  const chosen = comments !== null && (hasPosts === false || posts !== null);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const { purgeOn } = await api<{ purgeOn: string }>('/me', {
        method: 'DELETE',
        body: { password: me.hasPassword ? password : undefined, lang, comments, posts: hasPosts ? posts : undefined },
      });
      await refresh(); // signed out now
      navigate('/', { replace: true });
      showToast({ message: t('deleteAccount.done', { date: formatDate(purgeOn) }), action: { label: t('auth.blocked.support'), to: '/suport' } }, 12_000);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={t('deleteAccount.title')} onClose={busy ? undefined : onClose}>
      <form
        className="modal-body delete-account-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (sure && chosen) void confirm();
        }}
      >
        <h2>{t('deleteAccount.confirmTitle')}</h2>
        <p className="field-warning">
          <TriangleAlert size={16} aria-hidden="true" /> {t('deleteAccount.warning', { months: RETENTION_MONTHS })}
        </p>
        <ul className="delete-account-list">
          <li>{t('deleteAccount.pointSignedOut')}</li>
          <li>{t('deleteAccount.pointComments')}</li>
          <li>{t('deleteAccount.pointMistake')}</li>
          <li>{t('deleteAccount.pointForever', { months: RETENTION_MONTHS })}</li>
        </ul>
        <ChoiceGroup
          title={t('deleteAccount.commentsTitle')}
          name="comments"
          value={comments}
          onChange={setComments}
          options={{
            keep: [t('deleteAccount.commentsKeep'), t('deleteAccount.commentsKeepHint')],
            delete: [t('deleteAccount.commentsDelete'), t('deleteAccount.commentsDeleteHint')],
          }}
        />
        {hasPosts && (
          <ChoiceGroup
            title={t('deleteAccount.postsTitle')}
            name="posts"
            value={posts}
            onChange={setPosts}
            options={{
              keep: [t('deleteAccount.postsKeep'), t('deleteAccount.postsKeepHint')],
              delete: [t('deleteAccount.postsDelete'), t('deleteAccount.postsDeleteHint')],
            }}
          />
        )}
        {me.hasPassword && (
          <label className="field">
            <span className="field-label">{t('account.currentPassword')}</span>
            <input type="password" className="input" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
          </label>
        )}
        <label className="check-field">
          <input type="checkbox" checked={sure} onChange={(event) => setSure(event.target.checked)} />
          <span>{t('deleteAccount.sure')}</span>
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy || !sure || !chosen || (me.hasPassword && !password)}>
            {busy ? t('common.loading') : t('deleteAccount.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Choice = 'keep' | 'delete';

/** One of the dialog's questions: keep or delete (each with a line saying what it means). */
function ChoiceGroup(props: { title: string; name: string; value: Choice | null; onChange: (value: Choice) => void; options: Record<Choice, [string, string]> }) {
  return (
    <fieldset className="choice-group">
      <legend className="field-label">{props.title}</legend>
      <div className="choice-list">
        {(['keep', 'delete'] as const).map((value) => (
          <label key={value} className={`choice${props.value === value ? ' is-selected' : ''}`}>
            <input type="radio" name={props.name} value={value} checked={props.value === value} onChange={() => props.onChange(value)} />
            <span>
              <strong>{props.options[value][0]}</strong>
              <span className="muted small">{props.options[value][1]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
