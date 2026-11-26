import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

// How long the site keeps what it collects (what the Terms promise), and what's older than that. Nothing is deleted
// by itself: what's past its time is listed for administrators (admin panel, Settings → Old data), who are told when
// there is some (the hourly job, lib/accounts.ts) and delete it from there.

/** Support tickets (with their attachments). */
const TICKET_YEARS = 2;
/** Statistics (page views, actions) and what readers searched for. */
const STATS_MONTHS = 25;
/** The history of emails sent, and of the links in them. */
const EMAIL_LOG_DAYS = 90;
/** The administrators' log. */
const ADMIN_LOG_YEARS = 2;
/** Newsletter sign-ups never confirmed. */
const UNCONFIRMED_DAYS = 30;
/** Which posts the newsletter sent to whom; invitations. */
const DELIVERY_YEARS = 1;
const INVITE_YEARS = 1;

interface Part {
  table: string;
  /** Rows past their time. */
  where: string;
  /** The column that dates a row (for the oldest one). */
  date: string;
}

export const RETENTION = {
  tickets: [{ table: 'support_tickets', where: `created_at < UTC_TIMESTAMP() - INTERVAL ${TICKET_YEARS} YEAR`, date: 'created_at' }],
  stats: [
    { table: 'page_views', where: `day < UTC_DATE() - INTERVAL ${STATS_MONTHS} MONTH`, date: 'day' },
    { table: 'events', where: `day < UTC_DATE() - INTERVAL ${STATS_MONTHS} MONTH`, date: 'day' },
  ],
  searches: [{ table: 'search_log', where: `day < UTC_DATE() - INTERVAL ${STATS_MONTHS} MONTH`, date: 'day' }],
  emailLog: [{ table: 'email_log', where: `created_at < UTC_TIMESTAMP() - INTERVAL ${EMAIL_LOG_DAYS} DAY`, date: 'created_at' }],
  adminLog: [{ table: 'admin_log', where: `created_at < UTC_TIMESTAMP() - INTERVAL ${ADMIN_LOG_YEARS} YEAR`, date: 'created_at' }],
  // What links went out by email and what became of them (they work 1 to 48 hours): as long as the email history.
  emailLinks: [{ table: 'email_tokens', where: `created_at < UTC_TIMESTAMP() - INTERVAL ${EMAIL_LOG_DAYS} DAY`, date: 'created_at' }],
  // Sign-ins, 90 days after they ended or ran out (until then, the record of when and why).
  sessions: [
    {
      table: 'sessions',
      where: `COALESCE(ended_at, expires_at) < UTC_TIMESTAMP() - INTERVAL ${EMAIL_LOG_DAYS} DAY`,
      date: 'COALESCE(ended_at, expires_at)',
    },
  ],
  // Sign-in attempts (Logs → Sign-ins): as long as the sign-ins' record.
  authLog: [{ table: 'auth_log', where: `created_at < UTC_TIMESTAMP() - INTERVAL ${EMAIL_LOG_DAYS} DAY`, date: 'created_at' }],
  // The pushes sent, and the server's errors (the last time each happened).
  pushLog: [{ table: 'push_log', where: `created_at < UTC_TIMESTAMP() - INTERVAL ${EMAIL_LOG_DAYS} DAY`, date: 'created_at' }],
  errorLog: [{ table: 'error_log', where: `last_at < UTC_TIMESTAMP() - INTERVAL ${EMAIL_LOG_DAYS} DAY`, date: 'last_at' }],
  newsletterPending: [
    { table: 'newsletter_subscribers', where: `confirmed_at IS NULL AND created_at < UTC_TIMESTAMP() - INTERVAL ${UNCONFIRMED_DAYS} DAY`, date: 'created_at' },
  ],
  newsletterSent: [{ table: 'newsletter_deliveries', where: `sent_at < UTC_TIMESTAMP() - INTERVAL ${DELIVERY_YEARS} YEAR`, date: 'sent_at' }],
  invites: [{ table: 'invites', where: `created_at < UTC_TIMESTAMP() - INTERVAL ${INVITE_YEARS} YEAR`, date: 'created_at' }],
} satisfies Record<string, Part[]>;

export type RetentionKey = keyof typeof RETENTION;
export const RETENTION_KEYS = Object.keys(RETENTION) as RetentionKey[];

export interface DueData {
  key: RetentionKey;
  /** Rows past their time. */
  count: number;
  /** When the oldest of them is from. */
  oldest: string | null;
}

/** What's past its time, by kind (in one query). */
export async function retentionDue(db: Pool): Promise<DueData[]> {
  const parts = RETENTION_KEYS.flatMap((key) => (RETENTION[key] as Part[]).map((part, i) => ({ key, part, alias: `${key}_${i}` })));
  const [[row]] = await db.query<RowDataPacket[]>(
    `SELECT ${parts
      .map(
        ({ part, alias }) =>
          `(SELECT COUNT(*) FROM ${part.table} WHERE ${part.where}) AS ${alias}_n, (SELECT MIN(${part.date}) FROM ${part.table} WHERE ${part.where}) AS ${alias}_oldest`,
      )
      .join(', ')}`,
  );
  return RETENTION_KEYS.map((key) => {
    let count = 0;
    let oldest: Date | null = null;
    for (const { alias } of parts.filter((p) => p.key === key)) {
      count += Number(row![`${alias}_n`]);
      const value = row![`${alias}_oldest`] as Date | string | null;
      const date = value ? new Date(value) : null;
      if (date && (!oldest || date < oldest)) oldest = date;
    }
    return { key, count, oldest: oldest?.toISOString() ?? null };
  });
}

/** How many rows in all are past their time. */
export async function retentionTotal(db: Pool) {
  return (await retentionDue(db)).reduce((sum, item) => sum + item.count, 0);
}

/** Deletes what's past its time, of one kind (an administrator's choice); how many rows went. */
export async function clearRetention(db: Pool, key: RetentionKey) {
  let deleted = 0;
  for (const part of RETENTION[key] as Part[]) {
    const [result] = await db.execute<ResultSetHeader>(`DELETE FROM ${part.table} WHERE ${part.where}`);
    deleted += result.affectedRows;
  }
  return deleted;
}
