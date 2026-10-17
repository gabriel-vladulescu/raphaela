import mysql from 'mysql2/promise';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Config } from '@/config';
import { migrations } from '@/migrations';

export async function connectDb(options: Config['db']): Promise<Pool> {
  // timezone 'Z' + a UTC session keeps DATETIME/TIMESTAMP values in UTC end to end.
  const db = mysql.createPool({ ...options, connectionLimit: 10, timezone: 'Z' });
  db.pool.on('connection', (connection) => connection.query("SET time_zone = '+00:00'"));

  // A freshly started MySQL container takes a little while to accept connections.
  for (let attempt = 1; ; attempt++) {
    try {
      await db.query('SELECT 1');
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt === 15) {
        throw new Error(`Could not connect to MySQL at ${options.host}:${options.port} (${code}). Is it running? Try: npm run db`);
      }
      console.log(`Waiting for MySQL (${code})...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  await migrate(db);
  return db;
}

async function migrate(db: Pool) {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT UNSIGNED PRIMARY KEY)');
  const [rows] = await db.query<RowDataPacket[]>('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations');
  const current = Number(rows[0].version);

  for (let version = current + 1; version <= migrations.length; version++) {
    console.log(`Applying database migration ${version}...`);
    for (const statement of migrations[version - 1]) await db.query(statement);
    await db.query('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
  }
}
