import type { FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { deviceOf } from '@/lib/device';
import { logError } from '@/lib/errorLog';

// Every sign-in attempt: when, the account (when the address is one), the address typed, how (password, Google, a new
// account, a new password from an emailed link, an invitation) and how it went, and the browser ("Chrome · Windows";
// never the IP address). Administrators see it per account and in Logs → Sign-ins; it's kept as long as the email
// history (lib/retention.ts), and deleted with the account.

export type SignInMethod = 'password' | 'google' | 'signup' | 'reset' | 'invite';
export type SignInOutcome = 'ok' | 'wrong_password' | 'unknown_email' | 'google_only' | 'suspended' | 'deleted' | 'failed';

/** Notes a sign-in attempt. Never throws. */
export async function logSignIn(
  db: Pool,
  req: FastifyRequest,
  attempt: { userId: number | null; email: string | null; method: SignInMethod; outcome: SignInOutcome },
) {
  try {
    await db.execute('INSERT INTO auth_log (created_at, user_id, email, method, outcome, device) VALUES (UTC_TIMESTAMP(), ?, ?, ?, ?, ?)', [
      attempt.userId,
      attempt.email?.slice(0, 190) ?? null,
      attempt.method,
      attempt.outcome,
      deviceOf(req.headers['user-agent']),
    ]);
  } catch (err) {
    logError('other', 'auth log', err);
  }
}
