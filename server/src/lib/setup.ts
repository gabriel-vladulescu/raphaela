import crypto from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';

// First run: a fresh copy of the blog (no administrator yet) asks for its name and its first administrator on the
// setup page (/setup) before anything else. Only someone who can read the server's log can do it: it prints a code,
// which the page asks for (so nobody else finishing first can take the site).

let code: string | null = null;

export async function initSetup(db: Pool) {
  const [owners] = await db.query<RowDataPacket[]>("SELECT 1 FROM users WHERE role = 'owner' AND deleted_at IS NULL LIMIT 1");
  const [done] = await db.query<RowDataPacket[]>("SELECT 1 FROM app_settings WHERE name = 'setup_done'");
  if (owners.length || done.length) {
    if (!done.length) await finishSetup(db);
    code = null;
    return;
  }
  code = crypto.randomBytes(4).toString('hex').toUpperCase();
  console.log(`\n  ★ First run: open the site and finish the setup at /setup. Setup code: ${code}\n`);
}

export const setupNeeded = () => code !== null;

export function checkSetupCode(given: string) {
  if (!code) return false;
  const a = Buffer.from(given.trim().toUpperCase());
  const b = Buffer.from(code);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function finishSetup(db: Pool) {
  await db.query("INSERT IGNORE INTO app_settings (name, value) VALUES ('setup_done', UTC_TIMESTAMP())");
  code = null;
}
