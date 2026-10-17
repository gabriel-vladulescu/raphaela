import { useEffect, useState } from 'react';
import { useAuth } from '@/context/auth';
import { api, ApiError } from '@/lib/api';
import type { Role } from '@/lib/types';

/** A person's lists, at /{username}/articole and /{username}/articole-salvate. */
export type PersonList = 'articole' | 'articole-salvate';

/** What their pages show about them (server: routes/people.ts). */
export interface Person {
  username: string;
  name: string;
  picture: string | null;
  role: Role;
  occupation: string | null;
  quote: string | null;
  publicArticles: boolean;
  publicSaved: boolean;
  /** Their published posts. */
  articles: number;
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

export const isPublicList = (person: Person, list: PersonList) => (list === 'articole' ? person.publicArticles : person.publicSaved);

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
