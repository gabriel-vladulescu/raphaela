import { siteDayStart } from '@/lib/analytics';

// A period the admin panel's logs are looked at, or cleared, for: from one day to another (days of the site's time
// zone, "2026-11-01"), both included; either end can be left open.

const DAY = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;

/** The period's fields, for a route's querystring or body schema. */
export const periodProperties = { from: DAY, to: DAY } as const;

export interface Period {
  from?: string;
  to?: string;
}

const nextDay = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** SQL conditions for `column` (a date and time) within the period, with their params. */
export function periodWhere(column: string, period: Period): { where: string[]; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (period.from) {
    where.push(`${column} >= ?`);
    params.push(siteDayStart(period.from));
  }
  if (period.to) {
    where.push(`${column} < ?`);
    params.push(siteDayStart(nextDay(period.to)));
  }
  return { where, params };
}
