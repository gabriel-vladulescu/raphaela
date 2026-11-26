import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BookOpen, FileText, FolderTree, History, LifeBuoy, MessageSquare, Settings, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import type { LogEntry, LogPage } from '@/admin/types';
import { EmailHistory } from '@/admin/pages/EmailLog';
import { AuthTab, CleanupTab, EditsTab, ErrorsTab, PushTab } from '@/admin/pages/LogTabs';
import { Card, Empty, ErrorNote, LoadMore, Loading, PageHead, PeriodFilter, periodQuery, SearchBox, Select, Tabs } from '@/admin/ui';
import { UserSelect } from '@/admin/UserSelect';
import { Avatar } from '@/components/Avatar';
import { useAdmin } from '@/admin/context';
import { api } from '@/lib/api';

const GROUPS = ['user', 'comment', 'post', 'book', 'category', 'support', 'settings'] as const;
const ICONS: Record<string, LucideIcon> = {
  book: BookOpen,
  user: User,
  comment: MessageSquare,
  post: FileText,
  category: FolderTree,
  support: LifeBuoy,
  settings: Settings,
};

/** The logs' tabs (kept in the address, ?tab=…). */
const TABS = ['admin', 'auth', 'emails', 'push', 'errors', 'edits', 'cleanup'] as const;
type LogTab = (typeof TABS)[number];

/** Where an entry's target is in the panel (a person's page, the post in the list…), if it still exists there. */
function targetLink(entry: LogEntry) {
  const { type, id, label } = entry.target;
  const area = entry.action.split('.')[0];
  if (area === 'tag') return '/admin/categorii';
  if (area === 'media') return '/admin/media';
  if (area === 'newsletter') return '/admin/newsletter';
  if (area === 'invite') return '/admin/utilizatori';
  if (area === 'history') return '/admin/jurnal?tab=cleanup';
  if (area === 'cover') return null;
  if (type === 'book') return `/admin/carti?status=all&q=${encodeURIComponent(label.slice(0, 60))}`;
  if (type === 'support' && id) return `/admin/suport/${id}`;
  if (entry.action === 'settings.identity' || entry.action.startsWith('settings.logo')) return '/admin/setari?tab=identity';
  if (type === 'user' && id) return `/admin/utilizatori?id=${id}`;
  if (type === 'post') return `/admin/articole?status=all&q=${encodeURIComponent(label.slice(0, 60))}`;
  if (type === 'category') return '/admin/categorii';
  if (type === 'settings') return '/admin/setari';
  return null;
}

/** One entry as a sentence: "Ana suspended Ion's account for 7 days". */
export function useDescribe() {
  const { t } = useAdminI18n();
  return (entry: LogEntry): ReactNode => {
    const d = entry.details ?? {};
    const target = entry.target.label;
    const role = (value: unknown) => t(`role.${String(value)}` as AdminKey);
    switch (entry.action) {
      case 'user.role':
        return t('log.user.role', { target, from: role(d.from), to: role(d.to) });
      case 'user.suspend':
        return t(d.days ? 'log.user.suspend' : 'log.user.suspendForever', { target, n: Number(d.days ?? 0) }) + (d.reason ? ` — „${String(d.reason)}”` : '');
      case 'user.finalize':
        return [
          t('log.user.finalize', { target }),
          d.comments ? t(d.comments === 'delete' ? 'log.commentsDeleted' : 'log.commentsKept') : null,
          d.transferTo ? t('log.postsMoved', { name: String(d.transferTo) }) : d.posts === 'delete' ? t('log.postsDeleted') : null,
        ]
          .filter(Boolean)
          .join(' · ');
      case 'comment.delete':
        return t(d.author ? 'log.comment.deleteBy' : 'log.comment.delete', { target, author: String(d.author ?? '') }) + (Number(d.replies) > 0 ? ` (${t('log.withReplies', { n: Number(d.replies) })})` : '');
      case 'post.create':
      case 'book.create':
        return t(`log.${entry.action}` as AdminKey, { target, author: String(d.author ?? '') });
      case 'category.update':
        return d.renamedFrom ? t('log.category.rename', { target, from: String(d.renamedFrom) }) : t('log.category.update', { target });
      case 'settings.email': {
        const fields = Array.isArray(d.changed) ? (d.changed as string[]).map((f) => t(`log.field.${f}` as AdminKey)).join(', ') : '';
        return t('log.settings.email', { fields });
      }
      case 'settings.site':
        return Object.entries(d)
          .map(([key, value]) => {
            const setting = t(`log.setting.${key}` as AdminKey);
            if (typeof value === 'boolean') return t('log.settings.site', { setting, value: t(value ? 'log.on' : 'log.off') });
            if (key === 'blockedWords') return t('log.settings.words', { n: Number(value) });
            if (key === 'links') return t('log.settings.site', { setting, value: t(`general.links.${String(value)}` as AdminKey) });
            if (key === 'blockedWordsAction') return t('log.settings.site', { setting, value: t(`general.wordsAction.${String(value)}` as AdminKey) });
            if (key === 'announcement' && value && typeof value === 'object')
              return t((value as { enabled?: boolean }).enabled ? 'log.settings.announcementOn' : 'log.settings.announcementOff');
            return t('log.settings.changed', { setting });
          })
          .join(' · ');
      case 'settings.identity': {
        const fields = Array.isArray(d.changed) ? (d.changed as string[]).map((f) => t(`identity.field.${f}` as AdminKey)).join(', ') : '';
        return t('log.settings.identity', { fields });
      }
      case 'tag.rename':
      case 'tag.merge':
        return t(`log.${entry.action}` as AdminKey, { target, from: String(d.from ?? '') });
      case 'media.cleanup':
        return t('log.media.cleanup', { n: Number(d.files ?? target) });
      case 'user.profile': {
        const fields = Array.isArray(d.changed) ? (d.changed as string[]).map((f) => t(`profile.field.${f}` as AdminKey)).join(', ') : '';
        return t('log.user.profile', { target, fields });
      }
      case 'user.sessions_end':
        return t('log.user.sessions_end', { target, n: Number(d.sessions ?? 0) });
      case 'user.email_change':
      case 'user.email_change_cancel':
        return t(`log.${entry.action}` as AdminKey, { target, to: String(d.to ?? '') });
      case 'user.link_resend':
        return t(d.purpose === 'change' ? 'log.user.link_resend_change' : 'log.user.link_resend_verify', { target, to: String(d.to ?? '') });
      case 'book.publish':
      case 'book.unpublish':
      case 'book.restore':
      case 'book.reorder':
        return t(`log.${entry.action}` as AdminKey, { target, author: String(d.author ?? '') });
      case 'category.move':
        return t(d.direction === 'up' ? 'log.category.moveUp' : 'log.category.moveDown', { target });
      case 'support.reply':
        return t(d.inApp ? 'log.support.replyApp' : 'log.support.reply', { target, email: String(d.to ?? '') });
      case 'history.clear': {
        const deleted = Object.entries((d.deleted ?? {}) as Record<string, number>)
          .map(([key, n]) => `${t(`history.kind.${key}` as AdminKey)}: ${n}`)
          .join(', ');
        const period = d.from || d.to ? ` (${[d.from ?? '…', d.to ?? '…'].join(' – ')})` : '';
        return t('log.history.clear', { items: deleted }) + period;
      }
      case 'settings.cleanup': {
        const deleted = Object.entries((d.deleted ?? {}) as Record<string, number>)
          .map(([key, n]) => `${t(`cleanup.item.${key}` as AdminKey)}: ${n}`)
          .join(', ');
        return t('log.settings.cleanup', { items: deleted });
      }
      default:
        return t(`log.${entry.action}` as AdminKey, { target });
    }
  };
}

/**
 * The logs, in one place: what administrators did, the sign-in attempts, the emails, the pushes, the server's
 * errors, the comments' earlier versions, and clearing them by period. A tab and a period (from one day to another)
 * in the address, the period shared by the tabs.
 */
export function LogPage() {
  const { t } = useAdminI18n();
  const { overview } = useAdmin();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((value) => value === params.get('tab')) ?? 'admin') as LogTab;
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const counts: Partial<Record<LogTab, number>> = { errors: overview?.errors.unseen || undefined };
  return (
    <>
      <PageHead title={t('nav.log')} subtitle={t('logs.subtitle')} />
      <div className="adm-logs-head">
        <Tabs<LogTab>
          label={t('nav.log')}
          value={tab}
          // A new tab starts without the last one's filters (the period stays).
          onChange={(value) => setParams({ ...(value === 'admin' ? {} : { tab: value }), ...(from ? { from } : {}), ...(to ? { to } : {}) })}
          items={TABS.map((value) => ({ value, label: t(`logs.tab.${value}` as AdminKey), count: counts[value] }))}
        />
        <PeriodFilter
          from={from}
          to={to}
          onChange={(nextFrom, nextTo) =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              for (const [key, value] of [['from', nextFrom], ['to', nextTo]] as const) {
                if (value) next.set(key, value);
                else next.delete(key);
              }
              return next;
            })
          }
        />
      </div>
      {tab === 'admin' ? (
        <AdminLogTab />
      ) : tab === 'auth' ? (
        <AuthTab />
      ) : tab === 'emails' ? (
        <EmailHistory />
      ) : tab === 'push' ? (
        <PushTab />
      ) : tab === 'errors' ? (
        <ErrorsTab />
      ) : tab === 'edits' ? (
        <EditsTab />
      ) : (
        <CleanupTab />
      )}
    </>
  );
}

/** What administrators did, newest first, by day: who, what, on what. Filters: administrator, kind, words, period. */
function AdminLogTab() {
  const { t, formatDate, formatDateTime } = useAdminI18n();
  const describe = useDescribe();
  const [params, setParams] = useSearchParams();
  const group = GROUPS.find((value) => value === params.get('group')) ?? '';
  const admin = params.get('admin') ?? '';
  const q = params.get('q') ?? '';
  const period = periodQuery(params);
  const [data, setData] = useState<LogPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);

  const query = useCallback(
    (offset: number) =>
      `/admin/log?offset=${offset}&limit=30${group ? `&group=${group}` : ''}${admin ? `&admin=${admin}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}${period}`,
    [group, admin, q, period],
  );
  const load = useCallback(() => {
    setFailed(false);
    api<LogPage>(query(0))
      .then(setData)
      .catch(() => setFailed(true));
  }, [query]);
  useEffect(load, [load]);

  const set = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });

  async function loadMore() {
    if (!data) return;
    setMore(true);
    try {
      const next = await api<LogPage>(query(data.entries.length));
      setData({ ...next, entries: [...data.entries, ...next.entries] });
    } finally {
      setMore(false);
    }
  }

  // By day, newest first.
  const days: { day: string; entries: LogEntry[] }[] = [];
  for (const entry of data?.entries ?? []) {
    const day = new Date(entry.createdAt).toDateString();
    const last = days.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }

  return (
    <>
      <Card flush>
        <div className="adm-toolbar adm-toolbar-plain">
          <div className="adm-toolbar-row">
            <SearchBox value={q} onChange={(value) => set('q', value)} placeholder={t('log.search')} />
            <Select<string>
              label={t('log.group')}
              value={group}
              onChange={(value) => set('group', value)}
              options={[{ value: '', label: t('log.allGroups') }, ...GROUPS.map((value) => ({ value, label: t(`log.group.${value}` as AdminKey) }))]}
            />
            <UserSelect
              label={t('log.admin')}
              placeholder={t('log.allAdmins')}
              clear={t('log.allAdmins')}
              filter={{ role: 'owner' }}
              value={admin ? Number(admin) : null}
              onChange={(id) => set('admin', id ? String(id) : '')}
            />
          </div>
        </div>
        {failed ? (
          <ErrorNote message={t('common.loadFailed')} onRetry={load} />
        ) : !data ? (
          <Loading />
        ) : data.entries.length === 0 ? (
          <div className="adm-pad">
            <Empty icon={History} title={t('log.none')} body={t('log.noneBody')} />
          </div>
        ) : (
          <div className="adm-log">
            {days.map(({ day, entries }) => (
              <section key={day}>
                <h3 className="adm-log-day">{formatDate(entries[0]!.createdAt)}</h3>
                <ul>
                  {entries.map((entry) => {
                    const Icon = ICONS[entry.target.type] ?? History;
                    const link = targetLink(entry);
                    return (
                      <li key={entry.id}>
                        <Avatar name={entry.admin.name} picture={entry.admin.picture} size={30} />
                        <div className="adm-log-main">
                          <p>
                            <strong>{entry.admin.name}</strong> {describe(entry)}
                          </p>
                          <span className="adm-muted adm-small">
                            <Icon size={12} aria-hidden="true" /> <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                            {link && (
                              <>
                                {' · '}
                                <Link to={link} className="adm-link">
                                  {t('log.open')}
                                </Link>
                              </>
                            )}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
        {data?.hasMore && <LoadMore busy={more} onClick={() => void loadMore()} />}
      </Card>
    </>
  );
}
