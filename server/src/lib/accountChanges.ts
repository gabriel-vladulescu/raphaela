import type { Pool } from 'mysql2/promise';

// What an account was called before: each change of its address, name or username, with when and how. Kept as long
// as the account (deleting it for good deletes this too); administrators see it in the account's panel and find an
// account by an old address or username, and the person gets it in their data export.

export type ChangedField = 'email' | 'name' | 'username';
/** How it changed: in Profile, by a link sent to the new address, by connecting Google, or by an administrator. */
export type ChangedVia = 'profile' | 'email_link' | 'google' | 'admin';

/** Notes a change (nothing when the value is the same). */
export async function recordAccountChange(db: Pool, userId: number, field: ChangedField, oldValue: string | null, newValue: string | null, via: ChangedVia) {
  if ((oldValue ?? '') === (newValue ?? '')) return;
  await db.execute('INSERT INTO account_changes (user_id, field, old_value, new_value, via, changed_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())', [
    userId,
    field,
    oldValue,
    newValue,
    via,
  ]);
}
