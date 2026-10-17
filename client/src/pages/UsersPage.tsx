import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { Avatar } from '@/components/Avatar';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { AdminUser, Role } from '@/lib/types';

const EDITABLE_ROLES = ['member', 'author'] as const satisfies readonly Role[];

/** Owners give or take the author role. Owners themselves come from the server config (OWNER_EMAILS). */
export function UsersPage() {
  const { t, errorMessage, formatShortDate } = useI18n();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ users: AdminUser[] }>('/users')
      .then((data) => setUsers(data.users))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  async function changeRole(user: AdminUser, role: Role) {
    if (user.role === role) return;
    const setRole = (value: Role) => setUsers((list) => list?.map((u) => (u.id === user.id ? { ...u, role: value } : u)) ?? null);
    setRole(role);
    setError('');
    try {
      await api(`/users/${user.id}`, { method: 'PATCH', body: { role } });
    } catch (err) {
      setRole(user.role);
      setError(errorMessage(err));
    }
  }

  return (
    <div className="container">
      <HeaderBackLink to="/admin" label={t('admin.back')} />
      <section className="page-hero">
        <div className="page-hero-text">
          <h1>{t('users.title')}</h1>
          <p className="muted">{t('users.subtitle')}</p>
        </div>
      </section>

      {error && <p className="form-error">{error}</p>}
      {users === null ? (
        !error && <p className="muted">{t('common.loading')}</p>
      ) : (
        <ul className="users-list">
          {users.map((user) => (
            <li key={user.id} className="users-item card">
              <Avatar name={user.name} picture={user.picture} size={42} />
              <div className="users-main">
                <strong>{user.name}</strong>
                <span className="muted small users-email">{user.email}</span>
              </div>
              <span className="muted small users-meta">
                {t('users.posts', { n: user.postCount })} · {t('users.joined', { date: formatShortDate(user.createdAt) })}
              </span>
              {user.role === 'owner' ? (
                <span className="badge badge-owner users-role">{t('role.owner')}</span>
              ) : (
                <div className="segmented users-role" role="group" aria-label={t('users.roleFor', { name: user.name })}>
                  {EDITABLE_ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      className={user.role === role ? 'is-selected' : ''}
                      aria-pressed={user.role === role}
                      onClick={() => void changeRole(user, role)}
                    >
                      {t(`role.${role}`)}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
