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

  await migrate(db, options.database);
  return db;
}

async function migrate(db: Pool, database: string) {
  // A database made by a hosting panel can default to latin1 (MariaDB on cPanel): tables made later would be too, and
  // lose the diacritics. utf8mb4 from here on (the tables already there keep theirs).
  const [schema] = await db.query<RowDataPacket[]>('SELECT DEFAULT_CHARACTER_SET_NAME AS charset FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [
    database,
  ]);
  if (schema[0] && schema[0].charset !== 'utf8mb4') {
    await db.query(`ALTER DATABASE \`${database.replace(/`/g, '``')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  }
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INT UNSIGNED PRIMARY KEY)');
  const [rows] = await db.query<RowDataPacket[]>('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations');
  const current = Number(rows[0].version);

  for (let version = current + 1; version <= migrations.length; version++) {
    console.log(`Applying database migration ${version}...`);
    for (const statement of migrations[version - 1]) await db.query(statement);
    await db.query('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
  }
}
