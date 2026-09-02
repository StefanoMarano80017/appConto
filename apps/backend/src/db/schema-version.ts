import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Database as SqliteDatabase } from 'better-sqlite3';

/**
 * La versione dello schema, letta dai due lati che devono coincidere.
 *
 * Non esiste un secondo registro: la verità è già scritta in due posti che
 * Drizzle mantiene da sé — la tabella `__drizzle_migrations` nel database e il
 * file `meta/_journal.json` accanto alle migrazioni. Questo modulo si limita a
 * leggerli e a confrontarli, e la regola che usa è **la stessa** che usa il
 * migratore per decidere cosa applicare (`when` maggiore dell'ultimo
 * registrato). Se divergessero, la guardia direbbe una cosa e la migrazione ne
 * farebbe un'altra.
 *
 * Il database sta in `DATA_ROOT` e sopravvive agli aggiornamenti; le migrazioni
 * stanno in `APP_ROOT` e vengono sostituite. È esattamente questa asimmetria
 * che rende possibile ritrovarsi un archivio più recente dell'applicazione che
 * lo apre — il caso che la guardia deve rifiutare.
 */

/** La tabella in cui Drizzle registra ciò che ha applicato. */
const MIGRATIONS_TABLE = '__drizzle_migrations';

export interface SchemaVersion {
  /** Quante migrazioni risultano applicate. */
  readonly appliedCount: number;
  /**
   * L'istante della migrazione più recente, in millisecondi.
   *
   * È il campo `when` del journal, che Drizzle copia in `created_at`: è
   * l'unica grandezza con cui i due lati si possono confrontare.
   */
  readonly latestMillis: number;
}

export type SchemaComparison =
  /** Il database non è mai stato migrato: non c'è nulla da proteggere. */
  | 'nuovo'
  /** Database e applicazione sono alla stessa versione. */
  | 'allineato'
  /** L'applicazione ha migrazioni che il database non ha ancora. */
  | 'da-migrare'
  /** Il database è stato scritto da una versione più recente dell'applicazione. */
  | 'database-piu-recente';

/**
 * Il confronto fra le due versioni.
 *
 * È una funzione pura: prende due numeri e restituisce un verdetto. Tutte le
 * decisioni di sicurezza all'avvio derivano da qui, quindi doveva essere
 * verificabile senza aprire un database.
 *
 * `latestMillis` uguali significa "niente da fare": il migratore applica solo
 * le migrazioni con `when` **strettamente maggiore** dell'ultima registrata.
 */
export function compareSchema(database: SchemaVersion, app: SchemaVersion): SchemaComparison {
  if (database.appliedCount === 0) {
    return 'nuovo';
  }

  if (database.latestMillis > app.latestMillis) {
    return 'database-piu-recente';
  }

  return database.latestMillis === app.latestMillis ? 'allineato' : 'da-migrare';
}

/**
 * Cosa risulta applicato in un database.
 *
 * Funziona su qualunque connessione, non solo su quella attiva: è così che si
 * legge la versione di un backup prima di accettarlo.
 *
 * Un database senza la tabella delle migrazioni non è un errore — è un file
 * appena creato — e vale zero.
 */
export function readDatabaseSchema(sqlite: SqliteDatabase): SchemaVersion {
  const table = sqlite
    .prepare(`select name from sqlite_master where type = 'table' and name = ?`)
    .get(MIGRATIONS_TABLE);

  if (table === undefined) {
    return { appliedCount: 0, latestMillis: 0 };
  }

  const row = sqlite
    .prepare(
      `select count(*) as applied, coalesce(max(created_at), 0) as latest from "${MIGRATIONS_TABLE}"`,
    )
    .get() as { applied: number; latest: number };

  return { appliedCount: Number(row.applied), latestMillis: Number(row.latest) };
}

/** La cartella delle migrazioni non è utilizzabile: senza di essa non si può decidere nulla. */
export class MigrationJournalError extends Error {}

/**
 * La versione che l'applicazione porta con sé.
 *
 * Se il journal manca o è illeggibile ci si ferma invece di indovinare: non
 * conoscere la propria versione dello schema significa non poter stabilire se
 * l'archivio dell'utente è più recente, ed è precisamente il caso in cui non
 * si deve procedere.
 */
export function readAppSchema(migrationsFolder: string): SchemaVersion {
  const journalFile = path.join(migrationsFolder, 'meta', '_journal.json');

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(journalFile, 'utf8'));
  } catch (error) {
    throw new MigrationJournalError(
      `Registro delle migrazioni non leggibile (${journalFile}): ${
        error instanceof Error ? error.message : 'errore sconosciuto'
      }`,
    );
  }

  const entries =
    typeof parsed === 'object' && parsed !== null && 'entries' in parsed
      ? (parsed as { entries: unknown }).entries
      : undefined;

  if (!Array.isArray(entries)) {
    throw new MigrationJournalError(
      `Registro delle migrazioni malformato (${journalFile}): manca l'elenco "entries".`,
    );
  }

  let latestMillis = 0;
  for (const entry of entries) {
    const when =
      typeof entry === 'object' && entry !== null && 'when' in entry
        ? (entry as { when: unknown }).when
        : undefined;

    if (typeof when !== 'number' || !Number.isFinite(when)) {
      throw new MigrationJournalError(
        `Registro delle migrazioni malformato (${journalFile}): una voce non ha un campo "when" valido.`,
      );
    }

    latestMillis = Math.max(latestMillis, when);
  }

  return { appliedCount: entries.length, latestMillis };
}
