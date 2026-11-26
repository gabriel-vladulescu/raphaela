// Brings the database to the current schema and stops: the same migrations the server applies when it starts
// (src/db.ts), for when the code is updated before the server restarts (a host's terminal: `npm run migrate`).
import type { RowDataPacket } from 'mysql2/promise';
import { config } from '@/config';
import { connectDb } from '@/db';

const db = await connectDb(config.db);
const [rows] = await db.query<RowDataPacket[]>('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations');
console.log(`The database "${config.db.database}" is up to date (migration ${rows[0]!.version}).`);
await db.end();
