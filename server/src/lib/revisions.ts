import type { Pool, RowDataPacket } from 'mysql2/promise';

// A post's earlier versions: what it was before each editing session, to compare with and go back to (the editor's
// "Istoric versiuni"). A session is one person's saves within SESSION_MINUTES (autosave saves every few seconds, so
// not every save is a version).

const SESSION_MINUTES = 10;
/** The newest ones kept per post. */
const KEEP = 50;

/**
 * Before a save: keeps the post as it is now, if this save changes its text and starts a new session (the last
 * version is older, or someone else's), or brings back an earlier version (`always`: what it replaces stays too).
 */
export async function keepRevision(
  db: Pool,
  postId: number,
  userId: number,
  next: { title: string; excerpt: string; contentHtml: string; bannerUrl: string | null },
  always = false,
) {
  const [[current]] = await db.execute<RowDataPacket[]>('SELECT title, excerpt, content_html, banner_url FROM posts WHERE id = ?', [postId]);
  if (!current) return;
  const changed =
    current.title !== next.title || current.excerpt !== next.excerpt || current.content_html !== next.contentHtml || (current.banner_url ?? null) !== next.bannerUrl;
  if (!changed) return;
  const [recent] = await db.execute<RowDataPacket[]>(
    'SELECT 1 FROM post_revisions WHERE post_id = ? AND saved_by <=> ? AND saved_at > UTC_TIMESTAMP() - INTERVAL ? MINUTE ORDER BY saved_at DESC LIMIT 1',
    [postId, userId, SESSION_MINUTES],
  );
  if (recent.length && !always) return;
  await db.execute(
    'INSERT INTO post_revisions (post_id, saved_at, saved_by, title, excerpt, content_html, banner_url) VALUES (?, UTC_TIMESTAMP(), ?, ?, ?, ?, ?)',
    [postId, userId, current.title, current.excerpt, current.content_html, current.banner_url],
  );
  await db.execute(
    `DELETE FROM post_revisions WHERE post_id = ? AND id NOT IN (
       SELECT id FROM (SELECT id FROM post_revisions WHERE post_id = ? ORDER BY saved_at DESC, id DESC LIMIT ${KEEP}) newest)`,
    [postId, postId],
  );
}

export async function listRevisions(db: Pool, postId: number) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id, r.saved_at, r.title, CHAR_LENGTH(r.content_html) AS size, u.name AS saved_by
       FROM post_revisions r LEFT JOIN users u ON u.id = r.saved_by
      WHERE r.post_id = ? ORDER BY r.saved_at DESC, r.id DESC`,
    [postId],
  );
  return rows.map((row) => ({
    id: row.id as number,
    savedAt: row.saved_at as Date,
    title: row.title as string,
    size: Number(row.size),
    savedBy: (row.saved_by as string | null) ?? null,
  }));
}

export async function getRevision(db: Pool, postId: number, revisionId: number) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.id, r.saved_at, r.title, r.excerpt, r.content_html, r.banner_url, u.name AS saved_by
       FROM post_revisions r LEFT JOIN users u ON u.id = r.saved_by WHERE r.id = ? AND r.post_id = ?`,
    [revisionId, postId],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id as number,
        savedAt: row.saved_at as Date,
        savedBy: (row.saved_by as string | null) ?? null,
        title: row.title as string,
        excerpt: row.excerpt as string,
        contentHtml: row.content_html as string,
        bannerUrl: row.banner_url as string | null,
      }
    : null;
}
