import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Check } from 'lucide-react';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { PageBand } from '@/components/PageBand';
import { PushToggles } from '@/components/PushToggles';
import { followAuthors } from '@/components/FollowButton';
import { FollowingCard, NewsletterCard } from '@/components/SubscriptionCards';
import { useAuth } from '@/context/auth';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { personListPath } from '@/lib/paths';
import type { User } from '@/lib/types';

const METRICS = ['comments', 'likes', 'views'] as const;
type Metric = (typeof METRICS)[number];
const MILESTONES = [1, 10, 50, 100, 1000];

/** What the account wants to hear about (server: lib/notifications.ts). */
interface NotifySettings {
  newPosts: boolean;
  myCommentReplies: boolean;
  myCommentReactions: boolean;
  postLikes: boolean;
  postShares: boolean;
  postComments: boolean;
  postReplies: boolean;
  postReactions: boolean;
  views: boolean;
  viewsEvery: number;
  milestones: Record<Metric, number[]>;
  support: boolean;
  reports: boolean;
  accountDeletions: boolean;
  heldComments: boolean;
  mentions: boolean;
  followedAuthors: boolean;
}
type Switch = Exclude<keyof NotifySettings, 'viewsEvery' | 'milestones'>;

/**
 * Settings (any signed-in account): push on this device, and what to be notified of, by role. Members: new posts,
 * replies and reactions to their comments. Authors: also their posts' likes, shares, comments, replies, reactions,
 * views (every N) and milestones. Administrators: support tickets, reported comments and accounts to delete for good.
 * And who may see their lists (privacy).
 * Saved as they change.
 */
export function SettingsPage() {
  const { t, formatNumber } = useI18n();
  const { user, setUser, isOwner, canWrite } = useAuth();
  const me = user!; // RequireRole
  const [settings, setSettings] = useState<NotifySettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /** The views field as typed (saved once it's a whole number from 1 to 100,000). */
  const [every, setEvery] = useState('');
  const latest = useRef<NotifySettings | null>(null);
  const request = useRef(0);

  // The page's sections, as tabs at the top: a tap goes to one; scrolling marks the one in view.
  // The tabs, short (a phone shows them all): the cards keep their full titles.
  const sections = [
    { id: 'prefs-device', label: t('prefs.tab.device') },
    ...(isOwner ? [] : [{ id: 'prefs-privacy', label: t('prefs.tab.privacy') }]),
    { id: 'prefs-notifications', label: t('nav.notifications') },
    ...(canWrite && !isOwner ? [{ id: 'prefs-milestones', label: t('prefs.milestones') }] : []),
  ];
  const [section, setSection] = useState(sections[0]!.id);
  const sectionKey = sections.map((entry) => entry.id).join(',');
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries.find((entry) => entry.isIntersecting);
        if (seen) setSection(seen.target.id);
      },
      { rootMargin: '-25% 0px -65% 0px' },
    );
    for (const { id } of sections) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
    // Again once the notification sections are there (loaded).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionKey, settings !== null]);

  useEffect(() => {
    api<{ settings: NotifySettings }>('/me/notification-settings')
      .then((data) => {
        latest.current = data.settings;
        setSettings(data.settings);
        setEvery(String(data.settings.viewsEvery));
      })
      .catch(() => setFailed(true));
  }, []);

  // The whole set is sent each time, so two quick changes can't undo each other.
  async function save(change: Partial<NotifySettings>) {
    if (!latest.current) return;
    const next = { ...latest.current, ...change };
    latest.current = next;
    setSettings(next);
    setStatus('saving');
    const mine = ++request.current;
    try {
      await api('/me/notification-settings', { method: 'PUT', body: next });
      if (mine === request.current) setStatus('saved');
    } catch {
      if (mine === request.current) setStatus('error');
    }
  }

  useEffect(() => {
    if (!settings) return;
    const value = Number(every);
    if (!Number.isInteger(value) || value < 1 || value > 100_000 || value === latest.current?.viewsEvery) return;
    const timer = window.setTimeout(() => void save({ viewsEvery: value }), 600);
    return () => window.clearTimeout(timer);
  }, [every]);

  // Their lists, public or not: shown at once, put back if the server says no.
  async function savePrivacy(change: Partial<Pick<User, 'publicArticles' | 'publicBooks' | 'publicSaved'>>) {
    const before = me;
    setUser({ ...me, ...change });
    setStatus('saving');
    const mine = ++request.current;
    try {
      const { user: updated } = await api<{ user: User }>('/me/privacy', { method: 'PUT', body: change });
      setUser(updated);
      if (mine === request.current) setStatus('saved');
    } catch {
      setUser(before);
      if (mine === request.current) setStatus('error');
    }
  }

  const privacyRow = (key: 'publicArticles' | 'publicBooks' | 'publicSaved', label: MessageKey, path: string) => (
    <div className="prefs-row">
      <label className="switch-field">
        <span className="switch-text">
          <strong>{t(label)}</strong>
          <span className="field-hint">{t(me[key] ? 'prefs.publicHint' : 'people.private')}</span>
        </span>
        <input type="checkbox" role="switch" className="switch" checked={me[key]} onChange={(event) => void savePrivacy({ [key]: event.target.checked })} />
      </label>
      {me[key] && (
        <Link to={path} className="prefs-link">
          {window.location.host}
          {path}
        </Link>
      )}
    </div>
  );

  const row = (key: Switch, label: MessageKey, hint: MessageKey | null, extra?: ReactNode) => (
    <div className="prefs-row">
      <label className="switch-field">
        <span className="switch-text">
          <strong>{t(label)}</strong>
          {hint && <span className="field-hint">{t(hint)}</span>}
        </span>
        <input type="checkbox" role="switch" className="switch" checked={settings![key]} onChange={(event) => void save({ [key]: event.target.checked })} />
      </label>
      {extra}
    </div>
  );

  const toggleMilestone = (metric: Metric, value: number) => {
    const list = settings!.milestones[metric];
    const next = list.includes(value) ? list.filter((m) => m !== value) : [...list, value].sort((a, b) => a - b);
    void save({ milestones: { ...settings!.milestones, [metric]: next } });
  };

  return (
    <div className="container prefs-page">
      <HeaderBackLink />
      <PageBand
        title={t('prefs.title')}
        line={t('prefs.subtitle')}
        // (everything saves as it changes: whether it did, here)
        actions={
          <span className={`prefs-status${status === 'error' ? ' is-error' : ''}`} role="status">
            {status === 'saving' ? t('prefs.saving') : status === 'saved' ? (
              <>
                <Check size={15} aria-hidden="true" /> {t('prefs.saved')}
              </>
            ) : status === 'error' ? t('error.generic') : ''}
          </span>
        }
        tabsLabel={t('prefs.sections')}
        tabs={sections.map(({ id, label }) => ({
          key: id,
          label,
          active: section === id,
          onClick: () => {
            setSection(id);
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        }))}
      />

      <div className="prefs-grid">
        <section id="prefs-device" className="card prefs-card">
          <h2 className="side-title">{t('prefs.device')}</h2>
          <PushToggles mode="account" />
        </section>

        {!isOwner && (
        <section id="prefs-privacy" className="card prefs-card">
          <h2 className="side-title">{t('prefs.privacy')}</h2>
          {/* Each list, public or not: an author's journal and books, anyone's saved posts. */}
          {me.role === 'author' && privacyRow('publicArticles', 'prefs.publicArticles', personListPath(me.username, 'jurnal'))}
          {me.role === 'author' && privacyRow('publicBooks', 'prefs.publicBooks', personListPath(me.username, 'carti'))}
          {privacyRow('publicSaved', 'prefs.publicSaved', personListPath(me.username, 'salvate'))}
        </section>
        )}

        {failed ? (
          <p className="form-error">{t('error.generic')}</p>
        ) : !settings ? (
          <p className="muted">{t('common.loading')}</p>
        ) : isOwner ? (
          <section id="prefs-notifications" className="card prefs-card">
            <h2 className="side-title">{t('nav.notifications')}</h2>
            <p className="muted small">{t('prefs.adminNote')}</p>
            {row('support', 'prefs.support', 'prefs.supportHint')}
            {row('reports', 'prefs.reports', 'prefs.reportsHint')}
            {row('accountDeletions', 'prefs.accountDeletions', 'prefs.accountDeletionsHint')}
            {row('heldComments', 'prefs.heldComments', 'prefs.heldCommentsHint')}
          </section>
        ) : (
          <>
            <section id="prefs-notifications" className="card prefs-card">
              <h2 className="side-title">{t('prefs.forYou')}</h2>
              {row('newPosts', 'prefs.newPosts', 'prefs.newPostsHint')}
              {/* Following authors only where the site has more than one. */}
              {followAuthors() && row('followedAuthors', 'prefs.followedAuthors', 'prefs.followedAuthorsHint')}
              {row('myCommentReplies', 'prefs.myCommentReplies', 'prefs.myCommentRepliesHint')}
              {row('myCommentReactions', 'prefs.myCommentReactions', 'prefs.myCommentReactionsHint')}
              {row('mentions', 'prefs.mentions', 'prefs.mentionsHint')}
            </section>

            <NewsletterCard />
            <FollowingCard />

            {canWrite && (
              <section className="card prefs-card">
                <h2 className="side-title">{t('prefs.onPosts')}</h2>
                {row('postLikes', 'prefs.postLikes', 'prefs.postLikesHint')}
                {row('postShares', 'prefs.postShares', 'prefs.postSharesHint')}
                {row('postComments', 'prefs.postComments', 'prefs.postCommentsHint')}
                {row('postReplies', 'prefs.postReplies', 'prefs.postRepliesHint')}
                {row('postReactions', 'prefs.postReactions', 'prefs.postReactionsHint')}
                {row(
                  'views',
                  'prefs.views',
                  null,
                  <label className={`prefs-every${settings.views ? '' : ' is-off'}`}>
                    {t('prefs.viewsEveryBefore')}
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100_000}
                      className="input input-sm"
                      value={every}
                      disabled={!settings.views}
                      onChange={(event) => setEvery(event.target.value)}
                    />
                    {t('prefs.viewsEveryAfter')}
                  </label>,
                )}
              </section>
            )}

            {canWrite && (
              <section id="prefs-milestones" className="card prefs-card">
                <h2 className="side-title">{t('prefs.milestones')}</h2>
                <p className="muted small">{t('prefs.milestonesHint')}</p>
                {METRICS.map((metric) => (
                  <div key={metric} className="prefs-milestones" role="group" aria-label={t(`prefs.metric.${metric}`)}>
                    <span className="prefs-metric">{t(`prefs.metric.${metric}`)}</span>
                    <div className="prefs-chips">
                      {MILESTONES.map((value) => {
                        const on = settings.milestones[metric].includes(value);
                        return (
                          <button key={value} type="button" className={`prefs-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggleMilestone(metric, value)}>
                            {on && <Check size={14} aria-hidden="true" />}
                            {value === 1 ? t(`prefs.first.${metric}`) : formatNumber(value)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
