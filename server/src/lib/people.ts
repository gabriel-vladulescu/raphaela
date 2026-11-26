import type { Pool, RowDataPacket } from 'mysql2/promise';

/** The account behind /{username}/... */
export interface Person {
  id: number;
  username: string;
  name: string;
  picture: string | null;
  role: 'member' | 'author' | 'owner';
  occupation: string | null;
  quote: string | null;
  publicArticles: boolean;
  publicBooks: boolean;
  publicSaved: boolean;
}

/**
 * A person's public lists, at /{username}/jurnal, /{username}/carti and /{username}/salvate: an author's journal and
 * books, anyone's saved posts (an administrator has none of these). Each private unless they made it public (Settings);
 * their own, they always see.
 */
export type PersonList = 'jurnal' | 'carti' | 'salvate';
export const PERSON_LISTS: PersonList[] = ['jurnal', 'carti', 'salvate'];

/** Whether the list is one they have at all. */
export const hasList = (person: Pick<Person, 'role'>, list: PersonList) => (list === 'salvate' ? person.role !== 'owner' : person.role === 'author');

/** Whether anyone may see it. */
export const isPublicList = (person: Pick<Person, 'role' | 'publicArticles' | 'publicBooks' | 'publicSaved'>, list: PersonList) =>
  hasList(person, list) && (list === 'jurnal' ? person.publicArticles : list === 'carti' ? person.publicBooks : person.publicSaved);

export async function findPerson(db: Pool, username: string): Promise<Person | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, username, name, COALESCE(avatar_url, picture) AS picture, role, occupation, quote, public_articles, public_books, public_saved
       FROM users WHERE username = ? AND deleted_at IS NULL`,
    [username.toLowerCase()],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id as number,
        username: row.username as string,
        name: row.name as string,
        picture: row.picture as string | null,
        role: row.role as Person['role'],
        occupation: row.occupation as string | null,
        quote: row.quote as string | null,
        publicArticles: Boolean(row.public_articles),
        publicBooks: Boolean(row.public_books),
        publicSaved: Boolean(row.public_saved),
      }
    : null;
}
