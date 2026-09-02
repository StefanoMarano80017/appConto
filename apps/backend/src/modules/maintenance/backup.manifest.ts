import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { readDatabaseSchema, type SchemaVersion } from '../../db/schema-version.js';
import { openSqlite } from '../../db/sqlite.js';
import type { BackupKind } from './backup.naming.js';

/**
 * Il manifest di un backup: ciò che permette di verificarlo invece di sperarci.
 *
 * Un file `.sqlite` che SQLite riesce ad aprire non è un backup: è un file che
 * SQLite riesce ad aprire. Potrebbe essere l'archivio di un'altra
 * applicazione, una versione futura dello schema, o lo stesso archivio con
 * qualche byte cambiato da un disco che sta cedendo. Il manifest è il
 * documento che dice cosa dovrebbe esserci dentro — impronta, versione dello
 * schema, conteggi — così che chi ripristina possa controllarlo prima di
 * sostituire i dati veri.
 *
 * Vive accanto al database, come file `.json` con lo stesso nome. Un backup
 * senza manifest non viene accettato per il ripristino: non è un formato che
 * questa applicazione sappia verificare.
 */

/** Il formato riconosciuto. Un valore diverso significa "non so verificarlo". */
export const BACKUP_FORMAT = 'appconto-backup/1';

export interface BackupManifest {
  readonly format: string;
  readonly kind: BackupKind;
  /** L'istante esatto, in UTC: il nome del file porta invece l'ora locale. */
  readonly createdAt: string;
  readonly appVersion: string;
  readonly schemaVersion: SchemaVersion;
  /** Il nome del database a cui questo manifest appartiene. */
  readonly databaseFile: string;
  readonly databaseBytes: number;
  readonly databaseSha256: string;
  /** Righe per tabella applicativa, a scopo di confronto e di lettura umana. */
  readonly rowCounts: Record<string, number>;
}

/** Quanto si legge alla volta calcolando l'impronta. */
const HASH_CHUNK_BYTES = 1024 * 1024;

/**
 * L'impronta SHA-256 di un file, letto a blocchi.
 *
 * A blocchi e non tutto in memoria: l'archivio di un conto usato per anni può
 * pesare centinaia di megabyte, e un backup non deve essere l'operazione che
 * fa mancare la memoria all'applicazione. Resta sincrona come tutto il resto
 * dell'accesso ai dati in questo progetto.
 */
export function sha256OfFile(file: string): string {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  const handle = openSync(file, 'r');

  try {
    for (;;) {
      const read = readSync(handle, buffer, 0, HASH_CHUNK_BYTES, null);
      if (read === 0) {
        break;
      }
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(handle);
  }

  return hash.digest('hex');
}

/** Cosa si è trovato dentro un file candidato a essere un database. */
export type DatabaseInspection =
  | {
      readonly ok: true;
      readonly schema: SchemaVersion;
      readonly rowCounts: Record<string, number>;
      readonly bytes: number;
    }
  | { readonly ok: false; readonly problem: string };

/**
 * Apre un file in sola lettura e ne verifica la consistenza interna.
 *
 * Non solleva eccezioni: un file illeggibile o non-SQLite è un esito
 * previsto — è esattamente il caso che il ripristino deve saper rifiutare — e
 * chi chiama decide se è una richiesta sbagliata dell'utente o un guasto
 * interno.
 *
 * `integrity_check` e non `quick_check`: il controllo completo attraversa
 * l'intero file, e su un backup è il momento giusto per pagarlo.
 */
export function inspectDatabase(file: string): DatabaseInspection {
  let sqlite: Database.Database | undefined;

  try {
    const bytes = statSync(file).size;
    // `openSqlite` e non `new Database`: nel package il binario nativo va
    // indicato, e qui si apre un file che non è la connessione dell'app.
    sqlite = openSqlite(file, { readonly: true, fileMustExist: true });

    const integrity = sqlite.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      return { ok: false, problem: `integrity_check ha risposto "${String(integrity)}".` };
    }

    const tables = (
      sqlite
        .prepare(
          `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
        )
        .all() as { name: string }[]
    ).map((row) => row.name);

    const rowCounts: Record<string, number> = {};
    for (const table of tables) {
      // Le tabelle di servizio non sono dati dell'utente: la loro versione
      // viaggia già in `schema`, e nei conteggi sarebbero solo rumore.
      if (table.startsWith('__')) {
        continue;
      }

      const row = sqlite.prepare(`select count(*) as total from "${table}"`).get() as {
        total: number;
      };
      rowCounts[table] = Number(row.total);
    }

    return { ok: true, schema: readDatabaseSchema(sqlite), rowCounts, bytes };
  } catch (error) {
    return {
      ok: false,
      problem: error instanceof Error ? error.message : 'file non leggibile come database SQLite.',
    };
  } finally {
    sqlite?.close();
  }
}

/** Cosa si è trovato dentro un file candidato a essere un manifest. */
export type ManifestReading =
  | { readonly ok: true; readonly manifest: BackupManifest }
  | { readonly ok: false; readonly problem: string };

/** Il valore, se è una stringa non vuota. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Il valore, se è un numero finito e non negativo. */
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Interpreta il testo di un manifest.
 *
 * Ogni campo viene controllato: un manifest è un file su disco, e un file su
 * disco può essere stato scritto a metà, modificato a mano o prodotto da una
 * versione futura. Fidarsi della sua forma significherebbe far dipendere il
 * ripristino da un `JSON.parse` andato bene.
 */
export function parseManifest(content: string): ManifestReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, problem: 'il manifest non è JSON valido.' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, problem: 'il manifest non è un oggetto JSON.' };
  }

  const raw = parsed as Record<string, unknown>;

  const format = text(raw.format);
  if (format === null) {
    return { ok: false, problem: 'il manifest non dichiara il formato.' };
  }
  if (format !== BACKUP_FORMAT) {
    return {
      ok: false,
      problem: `formato di backup non supportato: "${format}" (atteso "${BACKUP_FORMAT}").`,
    };
  }

  const databaseSha256 = text(raw.databaseSha256);
  const databaseFile = text(raw.databaseFile);
  const createdAt = text(raw.createdAt);
  const kind = text(raw.kind);
  const databaseBytes = count(raw.databaseBytes);

  if (databaseSha256 === null || databaseFile === null || createdAt === null || kind === null) {
    return { ok: false, problem: 'il manifest è incompleto.' };
  }

  const schema = raw.schemaVersion;
  const asObject =
    typeof schema === 'object' && schema !== null ? (schema as Record<string, unknown>) : null;
  const appliedCount = asObject === null ? null : count(asObject.appliedCount);
  const latestMillis = asObject === null ? null : count(asObject.latestMillis);

  if (appliedCount === null || latestMillis === null) {
    return { ok: false, problem: 'il manifest non dichiara la versione dello schema.' };
  }

  const rowCounts: Record<string, number> = {};
  if (typeof raw.rowCounts === 'object' && raw.rowCounts !== null) {
    for (const [table, value] of Object.entries(raw.rowCounts as Record<string, unknown>)) {
      const total = count(value);
      if (total !== null) {
        rowCounts[table] = total;
      }
    }
  }

  return {
    ok: true,
    manifest: {
      format,
      kind: kind as BackupKind,
      createdAt,
      appVersion: text(raw.appVersion) ?? 'sconosciuta',
      schemaVersion: { appliedCount, latestMillis },
      databaseFile,
      databaseBytes: databaseBytes ?? 0,
      databaseSha256,
      rowCounts,
    },
  };
}
