import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Globe, Lock } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { SharePageButton } from '@/components/ShareSheet';
import { site } from '@/config';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { personListPath } from '@/lib/paths';
import { hasList, isPublicList, PERSON_LISTS } from '@/lib/people';
import type { PersonList, PersonView } from '@/lib/people';

/** Each list's tab, its page title ("{name}'s journal") and the line its share carries. */
const LIST_TEXT: Record<PersonList, { tab: MessageKey; title: MessageKey; share: MessageKey }> = {
  jurnal: { tab: 'people.tabJournal', title: 'people.journalOf', share: 'people.shareJournal' },
  carti: { tab: 'people.tabBooks', title: 'people.booksOf', share: 'people.shareBooks' },
  salvate: { tab: 'people.tabSaved', title: 'people.savedOf', share: 'people.shareSaved' },
};

/**
 * The top of a person's public pages (/{username}/jurnal, /carti, /salvate): who they are, and as tabs under them the
 * lists of theirs the viewer may open (their own: all they have, the private ones marked; anyone else: the public
 * ones), the one shown marked, with its share button while it's public. On their own pages, whether it's public, and
 * the way to Settings.
 */
export function PersonHeader({ view, list, actions }: { view: PersonView; list: PersonList; actions?: ReactNode }) {
  const { t, formatNumber } = useI18n();
  const { person, me } = view;
  const isPublic = isPublicList(person, list);
  const title = t(LIST_TEXT[list].title, { name: person.name });

  useEffect(() => {
    document.title = `${title} · ${site.name}`;
    return () => {
      document.title = site.name;
    };
  }, [title]);

  const lists = PERSON_LISTS.filter((which) => which === list || (me ? hasList(person, which) : isPublicList(person, which)));
  const count = (which: PersonList) => (which === 'jurnal' ? person.articles : which === 'carti' ? person.books : null);

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
                url: new URL(personListPath(person.username, list), window.location.origin).href,
                title,
                text: t(LIST_TEXT[list].share, { name: person.name, site: site.name }),
                image: new URL(view.shareImages[list], window.location.origin).href,
                heading: t('share.titleList'),
              }}
            />
          )}
          {actions}
        </div>
        <nav className="person-lists" aria-label={person.name}>
          {lists.map((which) => {
            const n = count(which);
            return (
              <Link
                key={which}
                to={personListPath(person.username, which)}
                className={which === list ? 'is-selected' : undefined}
                aria-current={which === list ? 'page' : undefined}
              >
                {t(LIST_TEXT[which].tab)}
                {n !== null && <span className="count-pill">{formatNumber(n)}</span>}
                {me && !isPublicList(person, which) && <Lock size={13} aria-label={t('people.private')} />}
              </Link>
            );
          })}
        </nav>
      </section>
      {/* Their own list: who sees it. */}
      {me && (
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
