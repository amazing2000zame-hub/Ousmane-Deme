import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import * as schema from './schema.js';

// Ensure the data directory exists before opening the database file
mkdirSync(dirname(config.dbPath), { recursive: true });

// Open SQLite database
const sqlite: DatabaseType = new Database(config.dbPath);

// Enable WAL journal mode for concurrent read performance
sqlite.pragma('journal_mode = WAL');

// Export typed Drizzle instance
export const db = drizzle(sqlite, { schema });

// Export raw sqlite for migrations and pragmas
export { sqlite };
