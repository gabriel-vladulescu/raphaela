import type { Pool, RowDataPacket } from 'mysql2/promise';
import { logError } from '@/lib/errorLog';

// Following an author is for sites with more than one: with a single author there's nobody to choose between, so
// Follow shows nowhere (publicSiteSettings().follow) and the server refuses it. An author: an account with the author
// role, or with posts (an administrator who writes), not deleted. Counted at start, every minute (index.ts), when an
// administrator changes a role, when an invitation to write is taken, when /api/site is asked, and (at most every
// 15 s) as the site's settings go out with a page.

/** A count this recent is fresh enough for a page. */
const FRESH_MS = 15_000;

/** The authors, as a condition on `u` (users). */
export const AUTHOR = `u.deleted_at IS NULL AND (u.role = 'author' OR EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.id))`;

let authors = 0;
let countedAt = 0;

/** Counts the site's authors again; whether following is on now. */
export async function countAuthors(db: Pool) {
  try {
    const [[row]] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM users u WHERE ${AUTHOR}`);
    authors = Number(row!.n);
    countedAt = Date.now();
  } catch (err) {
    logError('job', 'counting authors', err);
  }
  return followingOn();
}

/** Whether readers can follow authors: the site has more than one. */
export const followingOn = () => authors > 1;

/** The count, again if it's older than 15 s (before the site's settings go out with a page). */
export async function freshAuthorCount(db: Pool) {
  if (Date.now() - countedAt > FRESH_MS) await countAuthors(db);
}
