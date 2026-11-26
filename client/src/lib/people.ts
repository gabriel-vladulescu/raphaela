import { useEffect, useState } from 'react';
import { useAuth } from '@/context/auth';
import { api, ApiError } from '@/lib/api';
import type { PersonList } from '@/lib/paths';
import type { Role } from '@/lib/types';

export type { PersonList } from '@/lib/paths';

/** A person's lists, at /{username}/jurnal, /{username}/carti and /{username}/salvate, in their tabs' order. */
export const PERSON_LISTS: PersonList[] = ['jurnal', 'carti', 'salvate'];

/** What their pages show about them (server: routes/people.ts). */
export interface Person {
  username: string;
  name: string;
  picture: string | null;
  role: Role;
  occupation: string | null;
  quote: string | null;
  publicArticles: boolean;
  publicBooks: boolean;
  publicSaved: boolean;
  /** Their published articles, and their published books. */
  articles: number;
  books: number;
}

export interface PersonView {
  person: Person;
  /** The viewer's own pages. */
  me: boolean;
  /** The viewer manages their articles: themselves, or an administrator. */
  manage: boolean;
  /** Their lists' share images (there while the list is public). */
  shareImages: Record<PersonList, string>;
}

/** Whether the list is one they have at all: an author's journal and books, anyone's saved posts but an administrator's. */
export const hasList = (person: Pick<Person, 'role'>, list: PersonList) => (list === 'salvate' ? person.role !== 'owner' : person.role === 'author');

/** Whether anyone may see it (they made it public: Settings). */
export const isPublicList = (person: Person, list: PersonList) =>
  hasList(person, list) && (list === 'jurnal' ? person.publicArticles : list === 'carti' ? person.publicBooks : person.publicSaved);

/**
 * The person with this username, as the viewer sees them: null while loading, 'missing' when nobody has it, 'error'
 * when it couldn't be loaded. Loaded again when the viewer signs in or out.
 */
export function usePerson(username: string) {
  const { user, loading } = useAuth();
  const viewer = loading ? null : (user?.id ?? 0);
  const [state, setState] = useState<{ key: string; value: PersonView | 'missing' | 'error' } | null>(null);
  const key = `${username.toLowerCase()}|${viewer}`;

  useEffect(() => {
    if (viewer === null) return;
    let cancelled = false;
    api<PersonView>(`/u/${encodeURIComponent(username)}`)
      .then((data) => !cancelled && setState({ key, value: data }))
      .catch((err) => !cancelled && setState({ key, value: err instanceof ApiError && err.status === 404 ? 'missing' : 'error' }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state?.key === key ? state.value : null;
}
