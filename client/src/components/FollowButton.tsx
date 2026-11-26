import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { UserCheck, UserPlus } from 'lucide-react';
import { siteSettings } from '@/config';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Follow an author: their new posts reach you as such (the bell, and push if it's on). Not on one's own posts, and not
 * for administrators (they get only the administration's notifications). Signed out, it leads to sign-in. Nowhere
 * where the site has a single author (`followAuthors`).
 */
export const followAuthors = () => siteSettings.follow;

export function FollowButton({ authorId, followers: initialFollowers }: { authorId: number; followers: number }) {
  const { t, plural } = useI18n();
  const { user, isOwner } = useAuth();
  const location = useLocation();
  const [following, setFollowing] = useState(false);
  const [followers, setFollowers] = useState(initialFollowers);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || !followAuthors()) return;
    api<{ following: boolean; followers: number }>(`/authors/${authorId}/follow`)
      .then((state) => {
        setFollowing(state.following);
        setFollowers(state.followers);
      })
      .catch(() => undefined);
  }, [authorId, user?.id]);

  if (!followAuthors()) return null;
  if (user && (user.id === authorId || isOwner)) {
    return followers > 0 ? <span className="follow-count muted small">{plural('follow.count', followers)}</span> : null;
  }

  const count = followers > 0 && <span className="follow-count muted small">{plural('follow.count', followers)}</span>;
  if (!user) {
    return (
      <div className="follow">
        <Link to={`/login?next=${encodeURIComponent(location.pathname)}`} className="btn btn-secondary btn-sm">
          <UserPlus size={15} /> {t('follow.follow')}
        </Link>
        {count}
      </div>
    );
  }

  async function toggle() {
    setBusy(true);
    try {
      const state = await api<{ following: boolean; followers: number }>(`/authors/${authorId}/follow`, { method: following ? 'DELETE' : 'PUT' });
      setFollowing(state.following);
      setFollowers(state.followers);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="follow">
      <button type="button" className={`btn btn-sm ${following ? 'btn-ghost is-following' : 'btn-secondary'}`} aria-pressed={following} disabled={busy} onClick={() => void toggle()}>
        {following ? <UserCheck size={15} /> : <UserPlus size={15} />} {t(following ? 'follow.following' : 'follow.follow')}
      </button>
      {count}
    </div>
  );
}
