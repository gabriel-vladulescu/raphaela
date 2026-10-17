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
  publicSaved: boolean;
}

export async function findPerson(db: Pool, username: string): Promise<Person | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, username, name, COALESCE(avatar_url, picture) AS picture, role, occupation, quote, public_articles, public_saved
       FROM users WHERE username = ?`,
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
        publicSaved: Boolean(row.public_saved),
      }
    : null;
}
