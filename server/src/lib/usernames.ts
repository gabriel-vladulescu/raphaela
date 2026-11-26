import type { Pool, RowDataPacket } from 'mysql2/promise';
import { slugify } from '@/lib/slug';

// Usernames: the first part of an account's addresses (/{username}/articole, /{username}/articole-salvate). Made
// from the name when the account is created ("Victor Solaris" -> "victor.solaris"), changeable on the profile page.

/** Words the site uses at the start of its own addresses (and a few it may): never a username. */
export const RESERVED = new Set([
  'admin', 'api', 'articole', 'articles', 'assets', 'auth', 'autor', 'autori', 'ajutor', 'books', 'carte', 'carti', 'cautare', 'categorii',
  'contact', 'despre', 'drumuri', 'edit', 'editor', 'eticheta', 'etichete', 'help', 'home', 'icons', 'invitatie', 'jurnal', 'login', 'logout',
  'manifest', 'new', 'newsletter', 'notificari', 'notifications', 'nou', 'posts', 'preview', 'previzualizare', 'profil',
  'profile', 'raphaela', 'register', 'rss', 'salvate', 'saved', 'search', 'settings', 'setari', 'setup', 'sitemap', 'src',
  'statistici', 'stats', 'subiecte', 'support', 'suport', 'tags', 'u', 'uploads', 'user', 'users', 'www',
]);

/** 3 to 30 lowercase letters and digits; words joined by single dots, never at the start or the end. */
const PATTERN = /^(?=.{3,30}$)[a-z0-9]+(?:\.[a-z0-9]+)*$/;

export type UsernameProblem = 'username_invalid' | 'username_reserved' | 'username_taken';

export function usernameProblem(value: string): Exclude<UsernameProblem, 'username_taken'> | null {
  if (!PATTERN.test(value)) return 'username_invalid';
  if (RESERVED.has(value)) return 'username_reserved';
  return null;
}

/** Why `userId` can't take `value`, or null when they can (their own current one included). */
export async function usernameProblemFor(db: Pool, value: string, userId: number): Promise<UsernameProblem | null> {
  const problem = usernameProblem(value);
  if (problem) return problem;
  const [taken] = await db.execute<RowDataPacket[]>('SELECT id FROM users WHERE username = ? AND id <> ?', [value, userId]);
  return taken[0] ? 'username_taken' : null;
}

/** A username nobody has, from a name: its words joined by dots, then with 2, 3... after it. */
async function freeUsername(db: Pool, name: string, userId: number) {
  let base = slugify(name).replaceAll('-', '.').slice(0, 24).replace(/\.+$/, '');
  if (base.length < 3 || RESERVED.has(base)) base = `${base.length >= 2 ? base : 'cititor'}.${userId}`;
  const [rows] = await db.execute<RowDataPacket[]>('SELECT username FROM users WHERE username LIKE ? AND id <> ?', [`${base}%`, userId]);
  const taken = new Set(rows.map((row) => row.username as string));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Gives an account without one a username (two sign-ups racing for the same one: the second tries again). */
export async function assignUsername(db: Pool, userId: number, name: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.execute('UPDATE users SET username = ? WHERE id = ? AND username IS NULL', [await freeUsername(db, name, userId), userId]);
      return;
    } catch (err) {
      if ((err as { code?: string }).code !== 'ER_DUP_ENTRY') throw err;
    }
  }
}

/** At start-up: every account has a username (the ones made before usernames existed get theirs now). */
export async function ensureUsernames(db: Pool) {
  const [rows] = await db.query<RowDataPacket[]>('SELECT id, name FROM users WHERE username IS NULL AND purged_at IS NULL ORDER BY id');
  for (const row of rows) await assignUsername(db, row.id as number, row.name as string);
}
