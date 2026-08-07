import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../config.js';

mkdirSync(path.dirname(config.databaseFile), { recursive: true });

const sqlite = new Database(config.databaseFile);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

/**
 * Unica istanza Drizzle dell'applicazione.
 * Solo i repository delle feature devono utilizzarla.
 */
export const db = drizzle(sqlite);

export function runMigrations(): void {
  migrate(db, { migrationsFolder: config.migrationsFolder });
}
