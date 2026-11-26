import { Navigate, useLocation, useParams } from 'react-router';
import { useI18n } from '@/lib/i18n';
import { hasList, isPublicList, PERSON_LISTS, usePerson } from '@/lib/people';
import { PageError, PersonHeaderSkeleton } from '@/pages/ArticlesPage';
import { NotFoundPage } from '@/pages/StatusPages';
import { personListPath } from '@/lib/paths';

/** What a username alone can be (server/src/lib/usernames.ts); anything else at the root is just a missing page. */
const USERNAME = /^[a-z0-9]+(?:\.[a-z0-9]+)*$/i;

/**
 * Just /{username}: on to the first of their lists this viewer may see (their journal, books, saved posts: their own,
 * or public ones), as the tabs on their pages (PersonHeader); with none, nothing here. The server sends the same
 * redirect before the app loads (server/src/seo/page.ts, personIndex).
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
  const { person, me } = view;
  const first = PERSON_LISTS.find((list) => (me ? hasList(person, list) : isPublicList(person, list)));
  return first ? <Navigate to={`${personListPath(person.username, first)}${search}${hash}`} replace /> : <NotFoundPage />;
}
