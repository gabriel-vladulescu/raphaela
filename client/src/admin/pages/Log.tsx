import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FileText, FolderTree, History, MessageSquare, Settings, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAdminI18n } from '@/admin/i18n';
import type { AdminKey } from '@/admin/i18n';
import type { LogEntry, LogPage } from '@/admin/types';
import { Card, Empty, ErrorNote, LoadMore, Loading, PageHead, SearchBox, Select } from '@/admin/ui';
import { UserSelect } from '@/admin/UserSelect';
import { Avatar } from '@/components/Avatar';
import { api } from '@/lib/api';

const GROUPS = ['user', 'comment', 'post', 'category', 'settings'] as const;
const ICONS: Record<string, LucideIcon> = { user: User, comment: MessageSquare, post: FileText, category: FolderTree, settings: Settings };

/** Where an entry's target is in the panel (a person's page, the post in the list…), if it still exists there. */
function targetLink(entry: LogEntry) {
  const { type, id, label } = entry.target;
  const area = entry.action.split('.')[0];
  if (area === 'tag') return '/admin/categorii';
  if (area === 'media') return '/admin/media';
  if (area === 'newsletter') return '/admin/newsletter';
  if (area === 'invite') return '/admin/utilizatori';
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
        return t('log.post.create', { target, author: String(d.author ?? '') });
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
      default:
        return t(`log.${entry.action}` as AdminKey, { target });
    }
  };
}

/** What administrators did, newest first, by day: who, what, on what. Filters: administrator, kind, words. */
export function LogPage() {
  const { t, formatDate, formatDateTime } = useAdminI18n();
  const describe = useDescribe();
  const [params, setParams] = useSearchParams();
  const group = GROUPS.find((value) => value === params.get('group')) ?? '';
  const admin = params.get('admin') ?? '';
  const q = params.get('q') ?? '';
  const [data, setData] = useState<LogPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);

  const query = useCallback(
    (offset: number) => `/admin/log?offset=${offset}&limit=30${group ? `&group=${group}` : ''}${admin ? `&admin=${admin}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    [group, admin, q],
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
      <PageHead title={t('nav.log')} subtitle={t('log.subtitle')} />
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
