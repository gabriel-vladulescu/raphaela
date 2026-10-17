import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Globe, Lock } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { SharePageButton } from '@/components/ShareSheet';
import { site } from '@/config';
import { useI18n } from '@/lib/i18n';
import { articlesPath, savedPath } from '@/lib/paths';
import { isPublicList } from '@/lib/people';
import type { PersonList, PersonView } from '@/lib/people';

/**
 * The top of a person's pages: who they are, their lists the viewer may open (the one shown is marked), and sharing
 * the list when it's public. On their own pages, whether the list is public, with the way to Settings.
 */
export function PersonHeader({ view, list, actions }: { view: PersonView; list: PersonList; actions?: ReactNode }) {
  const { t, formatNumber } = useI18n();
  const { person, me, manage } = view;
  const isPublic = isPublicList(person, list);
  const listName = (which: PersonList) => t(which === 'articole' ? 'people.articlesOf' : 'people.savedOf', { name: person.name });
  // An administrator's own article list is every post (they write in authors' names).
  const everyone = me && person.role === 'owner';

  useEffect(() => {
    document.title = `${listName(list)} · ${site.name}`;
    return () => {
      document.title = site.name;
    };
  }, [list, person.name]);

  // Their lists: the one shown, and the others this viewer may open.
  const writes = person.role === 'author' || person.articles > 0 || everyone;
  const lists = (['articole', 'articole-salvate'] as const).filter(
    (which) => which === list || (which === 'articole' ? writes && (person.publicArticles || manage) : person.role !== 'owner' && (person.publicSaved || me)),
  );

  return (
    <>
      <section className="card person-head">
        <Avatar name={person.name} picture={person.picture} size={null} />
        <div className="person-head-text">
          <h1>{person.name}</h1>
          <span className="person-role">{person.occupation || t(`role.${person.role}`)}</span>
          {person.quote && <p className="person-quote">{t('quote.wrap', { text: person.quote })}</p>}
        </div>
        <div className="person-head-actions">
          {isPublic && (
            <SharePageButton
              item={{
                url: new URL(list === 'articole' ? articlesPath(person.username) : savedPath(person.username), window.location.origin).href,
                title: listName(list),
                text: t(list === 'articole' ? 'people.shareArticles' : 'people.shareSaved', { name: person.name, site: site.name }),
                image: new URL(view.shareImages[list], window.location.origin).href,
                heading: t('share.titleList'),
              }}
            />
          )}
          {actions}
        </div>
        <nav className="person-lists" aria-label={person.name}>
          {lists.map((which) => (
            <Link
              key={which}
              to={which === 'articole' ? articlesPath(person.username) : savedPath(person.username)}
              className={which === list ? 'is-selected' : undefined}
              aria-current={which === list ? 'page' : undefined}
            >
              {which === 'articole' ? t(everyone ? 'people.allArticles' : 'nav.manage') : t('nav.saved')}
              {which === 'articole' && !everyone && <span className="count-pill">{formatNumber(person.articles)}</span>}
              {me && !everyone && !isPublicList(person, which) && <Lock size={13} aria-label={t('people.private')} />}
            </Link>
          ))}
        </nav>
      </section>
      {/* Their own list: who sees it (an administrator's every-post list is theirs alone). */}
      {me && !everyone && (
        <p className={`notice person-privacy${isPublic ? ' is-public' : ''}`}>
          <span>
            {isPublic ? <Globe size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />}
            {t(isPublic ? 'people.publicHint' : 'people.privateHint')}
          </span>
          <Link to="/setari">{t('people.toSettings')}</Link>
        </p>
      )}
    </>
  );
}
