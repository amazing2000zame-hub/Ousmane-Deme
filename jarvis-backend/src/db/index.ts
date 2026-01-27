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

// Performance PRAGMAs (safe with WAL mode):
// - synchronous = NORMAL: Safe in WAL mode, skips fsync on most writes
// - cache_size = -64000: 64 MB page cache (negative value = KiB)
// - temp_store = MEMORY: Temp tables and indices kept in RAM
// - mmap_size = 268435456: 256 MB memory-mapped I/O
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('cache_size = -64000');
sqlite.pragma('temp_store = MEMORY');
sqlite.pragma('mmap_size = 268435456');

// Export typed Drizzle instance
export const db = drizzle(sqlite, { schema });

// Export raw sqlite for migrations and pragmas
export { sqlite };
