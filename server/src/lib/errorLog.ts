import type { Pool, ResultSetHeader } from 'mysql2/promise';

// What went wrong on the server, for the admin panel's logs (Logs → Errors): a request that failed (a 500), a
// background job (announcing new posts, the newsletter, the hourly housekeeping), a push the push service refused, a
// notification that couldn't be made. Each is also written to the server's console, as before. The same error
// (same source, place and message) again within REPEAT_MINUTES counts up on its row instead of adding one, so a
// failure that repeats every minute stays one line, marked new again.

export type ErrorSource = 'request' | 'job' | 'push' | 'mail' | 'notification' | 'process' | 'other';

const REPEAT_MINUTES = 60;

/** Set at startup (index.ts): until then, errors only reach the console. */
let pool: Pool | null = null;
export const setErrorLogPool = (db: Pool) => {
  pool = db;
};

/** The error's message and its stack (without the message line the stack starts with). */
function partsOf(err: unknown): { message: string; detail: string | null } {
  if (err instanceof Error) {
    const stack = err.stack?.split('\n').slice(1).join('\n').trim() || null;
    const code = (err as { code?: unknown }).code;
    return { message: `${err.message}${typeof code === 'string' && !err.message.includes(code) ? ` (${code})` : ''}`, detail: stack };
  }
  return { message: typeof err === 'string' ? err : JSON.stringify(err) ?? String(err), detail: null };
}

/**
 * Notes an error: in the console and in the log. Never throws (and never waits on the caller: the log is written in
 * the background). `context`: where, e.g. "GET /api/posts/x" or "newsletter".
 */
export function logError(source: ErrorSource, context: string, err: unknown, userId: number | null = null) {
  const { message, detail } = partsOf(err);
  console.warn(`[${source}] ${context}: ${message}`);
  const db = pool;
  if (!db) return;
  const short = message.slice(0, 500);
  const place = context.slice(0, 255);
  void (async () => {
    try {
      const [same] = await db.execute<ResultSetHeader>(
        `UPDATE error_log SET times = times + 1, last_at = UTC_TIMESTAMP(), seen_at = NULL, detail = COALESCE(?, detail)
          WHERE source = ? AND context = ? AND message = ? AND last_at > UTC_TIMESTAMP() - INTERVAL ? MINUTE
          ORDER BY id DESC LIMIT 1`,
        [detail, source, place, short, REPEAT_MINUTES],
      );
      if (same.affectedRows > 0) return;
      await db.execute(
        `INSERT INTO error_log (created_at, last_at, source, context, message, detail, user_id)
         VALUES (UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, ?, ?, ?, ?)`,
        [source, place, short, detail?.slice(0, 8000) ?? null, userId],
      );
    } catch (failure) {
      console.warn('The error log failed:', (failure as Error).message);
    }
  })();
}
