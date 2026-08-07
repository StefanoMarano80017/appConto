import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /** File SQLite locale: nessun server da configurare. */
  databaseFile: process.env.DATABASE_FILE ?? path.join(backendRoot, 'data', 'appconto.db'),
  migrationsFolder: path.join(backendRoot, 'drizzle'),
  /** Dimensione massima di un CSV accettato dall'endpoint di import. */
  maxCsvSize: '10mb',
} as const;
