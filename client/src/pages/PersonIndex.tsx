import { Navigate, useLocation, useParams } from 'react-router';
import { useI18n } from '@/lib/i18n';
import { usePerson } from '@/lib/people';
import type { PersonList } from '@/lib/people';
import { PageError, PersonHeaderSkeleton } from '@/pages/ArticlesPage';
import { NotFoundPage } from '@/pages/StatusPages';

/** What a username alone can be (server/src/lib/usernames.ts); anything else at the root is just a missing page. */
const USERNAME = /^[a-z0-9]+(?:\.[a-z0-9]+)*$/i;

/**
 * Just /{username}: on to the list of theirs this viewer may see, the way their page's tabs do (PersonHeader): their
 * articles if they write and the list is public (or the viewer manages it), else their saved posts; with neither
 * open, the articles for someone who writes, the saved posts otherwise (each page then says it's private). The server
 * sends the same redirect before the app loads (server/src/seo/page.ts, personIndex).
 */
export function PersonIndex() {
  const { username = '' } = useParams();
  const valid = USERNAME.test(username) && username.length >= 3 && username.length <= 30;
  return valid ? <ToPersonList username={username} /> : <NotFoundPage />;
}

function ToPersonList({ username }: { username: string }) {
  const { t } = useI18n();
  const { search, hash } = useLocation();
  const view = usePerson(username);
  if (view === 'missing') return <NotFoundPage />;
  if (view === 'error') return <PageError message={t('error.generic')} />;
  if (view === null) {
    return (
      <div className="container person-page">
        <PersonHeaderSkeleton />
      </div>
    );
  }

  const { person, me, manage } = view;
  const writes = person.role === 'author' || person.articles > 0 || (me && person.role === 'owner');
  const savedOpen = person.role !== 'owner' && (person.publicSaved || me);
  const list: PersonList = writes && (person.publicArticles || manage) ? 'articole' : savedOpen ? 'articole-salvate' : writes ? 'articole' : 'articole-salvate';
  return <Navigate to={`/${person.username}/${list}${search}${hash}`} replace />;
}
