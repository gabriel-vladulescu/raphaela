import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { MailPlus, RefreshCw, Send, X } from 'lucide-react';
import { useAdmin } from '@/admin/context';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import type { Invite } from '@/admin/types';
import { Badge, Card, Dialog, Field } from '@/admin/ui';
import type { Tone } from '@/admin/ui';
import { api } from '@/lib/api';

// Inviting someone to write here (server/src/lib/invites.ts): an email with a link (14 days) that makes their
// account an author's, or a new account already an author's.

const STATUS_TONE: Record<Invite['status'], Tone> = { pending: 'info', accepted: 'good', expired: 'neutral', revoked: 'neutral' };

/** "Invite an author": the address and a few words, sent at once. */
export function InviteDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const { t, lang, errorMessage } = useAdminI18n();
  const { refreshOverview } = useAdmin();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<boolean | null>(null);

  async function send() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ sent: boolean }>('/admin/invites', { method: 'POST', body: { email: email.trim(), message: message.trim() || undefined, lang } });
      setSent(result.sent);
      onSent();
      refreshOverview();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('invites.new')}
      onClose={onClose}
      footer={
        sent === null ? (
          <>
            <button type="button" className="adm-btn is-ghost" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button type="button" className="adm-btn is-primary" disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())} onClick={() => void send()}>
              <Send size={15} /> {busy ? t('common.loading') : t('invites.send')}
            </button>
          </>
        ) : (
          <button type="button" className="adm-btn is-primary" onClick={onClose}>
            {t('common.close')}
          </button>
        )
      }
    >
      {sent === null ? (
        <>
          <p className="adm-muted adm-small">{t('invites.intro')}</p>
          <Field label={t('invites.email')}>
            <input className="adm-input" type="email" maxLength={255} value={email} autoFocus onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label={t('invites.message')} hint={t('invites.messageHint')}>
            <textarea className="adm-input adm-textarea" rows={3} maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} />
          </Field>
          {error && <p className="adm-form-error">{error}</p>}
        </>
      ) : sent ? (
        <p className="adm-callout is-good adm-small">{t('invites.sentTo', { email: email.trim() })}</p>
      ) : (
        <p className="adm-callout is-bad adm-small">
          {t('invites.notSent')} <Link to="/admin/setari?tab=history">{t('invites.toHistory')}</Link>
        </p>
      )}
    </Dialog>
  );
}

/** The invitations sent: who to, by whom, and where each stands; send one again, or take it back. */
export function InvitesCard() {
  const { t, formatShortDate } = useAdminI18n();
  const { refreshOverview } = useAdmin();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    api<{ invites: Invite[] }>('/admin/invites')
      .then((data) => setInvites(data.invites))
      .catch(() => setInvites([]));
  }, []);
  useEffect(load, [load]);

  async function run(invite: Invite, action: 'resend' | 'revoke') {
    setBusy(invite.id);
    setNote('');
    try {
      if (action === 'resend') {
        const { sent } = await api<{ sent: boolean }>(`/admin/invites/${invite.id}/resend`, { method: 'POST' });
        setNote(sent ? t('invites.sentTo', { email: invite.email }) : t('invites.notSent'));
      } else {
        await api(`/admin/invites/${invite.id}`, { method: 'DELETE' });
      }
      load();
      refreshOverview();
    } finally {
      setBusy(null);
    }
  }

  if (!invites || invites.length === 0) return null;
  return (
    <Card title={t('invites.title')}>
      {note && <p className="adm-muted adm-small">{note}</p>}
      <ul className="adm-invites">
        {invites.map((invite) => (
          <li key={invite.id} className="adm-invite">
            <div className="adm-invite-main">
              <strong>{invite.email}</strong>
              <span className="adm-muted adm-small">
                {invite.invitedBy ? t('invites.by', { name: invite.invitedBy, date: formatShortDate(invite.createdAt) }) : formatShortDate(invite.createdAt)}
                {invite.status === 'pending' && ` · ${t('invites.until', { date: formatShortDate(invite.expiresAt) })}`}
                {invite.accepted && (
                  <>
                    {' · '}
                    <Link to={`/admin/utilizatori?id=${invite.accepted.id}`}>{invite.accepted.name}</Link>
                  </>
                )}
              </span>
            </div>
            <Badge tone={STATUS_TONE[invite.status]}>{t(`invites.status.${invite.status}` as AdminKey)}</Badge>
            {(invite.status === 'pending' || invite.status === 'expired') && (
              <div className="adm-row-actions">
                <button type="button" className="adm-icon-btn" title={t('invites.resend')} aria-label={t('invites.resend')} disabled={busy === invite.id} onClick={() => void run(invite, 'resend')}>
                  <RefreshCw size={15} />
                </button>
                {invite.status === 'pending' && (
                  <button type="button" className="adm-icon-btn is-danger" title={t('invites.revoke')} aria-label={t('invites.revoke')} disabled={busy === invite.id} onClick={() => void run(invite, 'revoke')}>
                    <X size={15} />
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export const InviteIcon = MailPlus;
