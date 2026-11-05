import { useState } from 'react';
import { MessageSquare, FileText, TriangleAlert } from 'lucide-react';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminUser } from '@/admin/types';
import { Badge, Dialog, Field } from '@/admin/ui';
import { UserSelect } from '@/admin/UserSelect';
import { api } from '@/lib/api';

/**
 * Deletes a deleted account for good (its 3 months are up), as its person chose: their comments kept without a name
 * or deleted with the replies under them; an author's posts deleted, or kept and moved to another author picked here.
 * It can't be undone, so it's said plainly and confirmed with a tick.
 */
export function FinalizeDialog({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const { t, errorMessage } = useAdminI18n();
  const deletion = user.deletion!;
  const keepsPosts = deletion.posts !== 'delete' && deletion.postsTotal > 0;
  const [transferTo, setTransferTo] = useState<number | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api(`/admin/users/${user.id}/finalize`, { method: 'POST', body: { transferTo: keepsPosts ? transferTo : null } });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('finalize.title', { name: user.name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="adm-btn is-ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="adm-btn is-danger" onClick={() => void submit()} disabled={busy || !sure || (keepsPosts && !transferTo)}>
            {busy ? t('common.loading') : t('finalize.submit')}
          </button>
        </>
      }
    >
      <p className="adm-muted">{t('finalize.body', { email: user.email })}</p>
      <ul className="adm-choices">
        <li>
          <MessageSquare size={16} aria-hidden="true" />
          <span>
            <strong>{t('finalize.comments')}</strong>{' '}
            <Badge tone={deletion.comments === 'delete' ? 'bad' : 'neutral'}>{t(deletion.comments === 'delete' ? 'deletion.delete' : 'deletion.keep')}</Badge>
            <br />
            <span className="adm-muted adm-small">{t(deletion.comments === 'delete' ? 'finalize.commentsDelete' : 'finalize.commentsKeep')}</span>
          </span>
        </li>
        {deletion.postsTotal > 0 && (
          <li>
            <FileText size={16} aria-hidden="true" />
            <span>
              <strong>{t('finalize.posts', { n: deletion.postsTotal })}</strong>{' '}
              <Badge tone={deletion.posts === 'delete' ? 'bad' : 'neutral'}>{t(deletion.posts === 'delete' ? 'deletion.delete' : 'deletion.keep')}</Badge>
              <br />
              <span className="adm-muted adm-small">{t(deletion.posts === 'delete' ? 'finalize.postsDelete' : 'finalize.postsKeep')}</span>
            </span>
          </li>
        )}
      </ul>
      {keepsPosts && (
        <Field label={t('finalize.transferTo')} hint={t('finalize.transferHint')}>
          <UserSelect
            block
            label={t('finalize.transferTo')}
            placeholder={t('finalize.pickAuthor')}
            filter={{ role: 'author', active: true, exclude: user.id }}
            value={transferTo}
            onChange={setTransferTo}
          />
        </Field>
      )}
      <p className="adm-callout is-bad adm-small">
        <TriangleAlert size={16} aria-hidden="true" /> {t('finalize.warning')}
      </p>
      <label className="adm-check">
        <input type="checkbox" checked={sure} onChange={(event) => setSure(event.target.checked)} />
        <span>{t('finalize.sure')}</span>
      </label>
      {error && <p className="adm-form-error">{error}</p>}
    </Dialog>
  );
}
