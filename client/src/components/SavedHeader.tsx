import { useEffect } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Globe, Lock } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { SharePageButton } from '@/components/ShareSheet';
import { site } from '@/config';
import { useI18n } from '@/lib/i18n';
import { articlesPath, savedPath } from '@/lib/paths';
import type { PersonView } from '@/lib/people';

/**
 * TEMPORARY: the variants of the top of a saved-posts page (/{username}/articole-salvate) being compared, until one
 * is chosen. All of them name the list first ("Articole salvate"; someone else's: "… de {name}"), then how many,
 * whether it's public (their own: a link to Settings), sharing when it's public, and their articles' list if any.
 * A: centred, as on the profile and support pages. B: the title on the left, the actions on the right. C: a slim
 * strip with a small picture.
 */
export function SavedHeader({ view, count, variant }: { view: PersonView; count: number | null; variant: 'a' | 'b' | 'c' }) {
  const { t, plural } = useI18n();
  const { person, me, manage } = view;
  const title = me ? t('saved.title') : t('people.savedOf', { name: person.name });

  useEffect(() => {
    document.title = `${t('people.savedOf', { name: person.name })} · ${site.name}`;
    return () => {
      document.title = site.name;
    };
  }, [person.name]);

  const countText = count === null ? null : plural('people.saved', count);
  const privacy = me && (
    <Link to="/setari" className={`list-privacy${person.publicSaved ? ' is-public' : ''}`} title={t('people.privacyChange')}>
      {person.publicSaved ? <Globe size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
      {t(person.publicSaved ? 'people.publicShort' : 'people.onlyYou')}
    </Link>
  );
  const share = person.publicSaved && (
    <SharePageButton
      item={{
        url: new URL(savedPath(person.username), window.location.origin).href,
        title: t('people.savedOf', { name: person.name }),
        text: t('people.shareSaved', { name: person.name, site: site.name }),
        image: new URL(view.shareImages['articole-salvate'], window.location.origin).href,
        heading: t('share.titleList'),
      }}
    />
  );
  // Their articles' list, when there's one this viewer may open.
  const writes = person.role === 'author' || person.articles > 0;
  const articles = writes && (person.publicArticles || manage) && (
    <Link to={articlesPath(person.username)} className="list-other">
      {me ? t('people.myArticles') : t('people.articlesOf', { name: person.name })} <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
  const meta = (
    <p className="list-meta">
      {!me && variant === 'b' && (
        <span className="list-person">
          <Avatar name={person.name} picture={person.picture} size={22} /> {person.name}
        </span>
      )}
      {me && variant === 'c' && <span>{person.name}</span>}
      {countText && <span>{countText}</span>}
      {privacy}
    </p>
  );

  if (variant === 'c') {
    return (
      <header className="card list-band">
        <Avatar name={person.name} picture={person.picture} size={44} />
        <div className="list-band-text">
          <h1>{title}</h1>
          {meta}
        </div>
        <div className="list-actions">
          {articles}
          {share}
        </div>
      </header>
    );
  }
  return (
    <header className={`list-head${variant === 'a' ? ' is-centred' : ''}`}>
      {variant === 'a' && !me && <Avatar name={person.name} picture={person.picture} size={56} />}
      <div className="list-head-text">
        <h1>{title}</h1>
        {meta}
      </div>
      {(share || articles) && (
        <div className="list-actions">
          {articles}
          {share}
        </div>
      )}
    </header>
  );
}
