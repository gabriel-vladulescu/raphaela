import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { BarChart3, ChevronRight, FileText, FolderTree, LifeBuoy, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { HeaderBackLink } from '@/components/HeaderBackLink';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

/** The hub's numbers (server: routes/admin.ts). */
interface Overview {
  tickets: { total: number; unseen: number };
  posts: { published: number; scheduled: number; drafts: number };
  categories: { total: number; top: number };
  users: { total: number; authors: number };
  week: { views: number; visitors: number };
}

interface Section {
  to: string;
  icon: LucideIcon;
  title: MessageKey;
  hint: MessageKey;
  /** The main number and its name, then a line with more. */
  value: (data: Overview) => number;
  caption: MessageKey;
  more: (data: Overview) => string;
  /** Something waiting (new tickets): the number stands out. */
  alert?: (data: Overview) => boolean;
}

/**
 * /admin, for administrators (the account menu's "Administrare"): their sections, each with its main numbers:
 * support tickets, articles, categories, users and statistics.
 */
export function AdminDashboard() {
  const { t, formatNumber: n } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<Overview>('/admin/overview')
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  const sections: Section[] = [
    {
      to: '/admin/suport',
      icon: LifeBuoy,
      title: 'nav.supportTickets',
      hint: 'admin.ticketsHint',
      value: (d) => d.tickets.unseen,
      caption: 'admin.ticketsNew',
      more: (d) => t('admin.total', { n: n(d.tickets.total) }),
      alert: (d) => d.tickets.unseen > 0,
    },
    {
      to: '/admin/articole',
      icon: FileText,
      title: 'nav.manage',
      hint: 'admin.postsHint',
      value: (d) => d.posts.published,
      caption: 'admin.published',
      more: (d) => t('admin.postsMore', { drafts: n(d.posts.drafts), scheduled: n(d.posts.scheduled) }),
    },
    {
      to: '/admin/categories',
      icon: FolderTree,
      title: 'nav.categories',
      hint: 'admin.categoriesHint',
      value: (d) => d.categories.total,
      caption: 'admin.categoriesCount',
      more: (d) => t('admin.categoriesMore', { n: n(d.categories.top) }),
    },
    {
      to: '/admin/users',
      icon: Users,
      title: 'nav.users',
      hint: 'admin.usersHint',
      value: (d) => d.users.total,
      caption: 'admin.accountsCount',
      more: (d) => t('admin.usersMore', { n: n(d.users.authors) }),
    },
    {
      to: '/admin/statistici',
      icon: BarChart3,
      title: 'nav.stats',
      hint: 'admin.statsHint',
      value: (d) => d.week.views,
      caption: 'admin.weekViews',
      more: (d) => t('admin.weekMore', { n: n(d.week.visitors) }),
    },
  ];

  return (
    <div className="container admin-page">
      <HeaderBackLink />
      <section className="page-hero">
        <div className="page-hero-text">
          <h1>{t('admin.title')}</h1>
          <p className="muted">{t('admin.subtitle')}</p>
        </div>
      </section>
      {failed && <p className="form-error">{t('error.generic')}</p>}
      <nav className="admin-hub" aria-label={t('admin.title')}>
        {sections.map((section) => {
          const Icon = section.icon;
          const alert = data && section.alert?.(data);
          return (
            <Link key={section.to} to={section.to} className={`card admin-hub-card${alert ? ' is-alert' : ''}`}>
              <span className="admin-hub-top">
                <span className="admin-hub-icon">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <ChevronRight size={20} className="admin-hub-go" aria-hidden="true" />
              </span>
              <strong className="admin-hub-title">{t(section.title)}</strong>
              <span className="admin-hub-hint">{t(section.hint)}</span>
              <span className="admin-hub-numbers">
                {data ? (
                  <>
                    <span className="admin-hub-value">
                      <strong>{n(section.value(data))}</strong> {t(section.caption)}
                    </span>
                    <span className="admin-hub-more">{section.more(data)}</span>
                  </>
                ) : (
                  <span className="skeleton skeleton-line admin-hub-skeleton" aria-hidden="true" />
                )}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
