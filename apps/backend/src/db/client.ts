import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { config } from '../config.js';
import { applyPendingRestore } from '../modules/maintenance/restore-pending.js';
import { ensureDataDirectories } from '../paths.js';
import { readDatabaseSchema, type SchemaVersion } from './schema-version.js';
import { openSqlite } from './sqlite.js';

/**
 * L'unica connessione al database.
 *
 *     restore in attesa -> open -> configure -> migrate -> serve -> checkpoint -> close
 *
 * `sqlite` resta privato del modulo: i repository ricevono soltanto `db`, e
 * non esiste un secondo punto da cui il database possa essere aperto o chiuso.
 * Ciò che il resto dell'applicazione può fare oltre a interrogarlo è dichiarato
 * qui sotto, un verbo alla volta: una transazione, uno snapshot, la versione
 * dello schema, la chiusura.
 */

ensureDataDirectories();

/**
 * Il ripristino differito si applica adesso, e non altrove.
 *
 * È l'unico istante in cui nessuna connessione al database esiste: dopo la
 * riga successiva sostituire il file significherebbe scambiarlo sotto i piedi
 * di SQLite. Sta prima dell'apertura, non in `main.ts`, proprio perché
 * l'ordine non deve poter essere invertito da chi comporrà l'avvio in futuro.
 */
applyPendingRestore({
  dataRoot: config.dataRoot,
  databaseFile: config.databaseFile,
  tmpDir: config.tmpDir,
  migrationsFolder: config.migrationsFolder,
});

const sqlite = openSqlite(config.databaseFile);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

/**
 * Unica istanza Drizzle dell'applicazione.
 * Solo i repository delle feature devono utilizzarla.
 */
export const db = drizzle(sqlite);

/**
 * Esegue `work` come una sola transazione SQLite.
 *
 * Si chiama `atomically` e non `transaction` perché in questa applicazione
 * "transazione" è già una cosa: un movimento bancario. Il verbo dice cosa
 * garantisce, e non si confonde con il dominio.
 *
 * Tutto o niente: se `work` solleva un errore nulla di ciò che ha scritto
 * resta. È la garanzia che manca a un ciclo di inserimenti, dove un guasto a
 * metà lascerebbe un archivio riempito per metà — indistinguibile, per chi lo
 * guarda dopo, da un archivio completo.
 *
 * Le chiamate si possono annidare: `better-sqlite3` usa un SAVEPOINT quando
 * una transazione ne apre un'altra, quindi un servizio può racchiudere in una
 * transazione unica delle operazioni che sono già transazionali di per sé.
 * L'annullamento risale fino alla più esterna.
 */
export function atomically<T>(work: () => T): T {
  return sqlite.transaction(work)();
}

/**
 * Scrive in `destination` una copia consistente del database.
 *
 * `VACUUM INTO` e non una copia del file: in modalità WAL le scritture recenti
 * vivono in un file separato, e copiare il solo `.sqlite` produrrebbe un
 * archivio indietro nel tempo — mentre copiare i due file mentre l'app scrive
 * ne produrrebbe uno incoerente. SQLite, invece, legge il proprio stato
 * committato e ne scrive una versione compattata: uno snapshot, preso senza
 * fermare l'applicazione.
 *
 * Non si può eseguire dentro una transazione, ed è giusto che sia un errore
 * chiaro: un backup preso nel mezzo di un import non avrebbe senso.
 */
export function vacuumInto(destination: string): void {
  if (sqlite.inTransaction) {
    throw new Error('Impossibile creare uno snapshot durante una transazione.');
  }

  sqlite.prepare('VACUUM INTO ?').run(destination);
}

/** La versione dello schema registrata nel database attivo. */
export function databaseSchema(): SchemaVersion {
  return readDatabaseSchema(sqlite);
}

/**
 * Applica le migrazioni non ancora registrate nel database.
 *
 * Drizzle le esegue tutte dentro un'unica transazione e annulla l'intero
 * blocco al primo errore, quindi lo schema non resta mai a metà. Non contiene
 * però nessuna difesa contro un archivio più recente dell'applicazione, né
 * crea un backup: quelle decisioni stanno in `db/safe-migrate.ts`, che è
 * l'unico punto da cui questa funzione va chiamata in produzione.
 *
 * `migrationsFolder` è un parametro perché i test possano descrivere una
 * migrazione fallimentare senza toccare quelle reali.
 */
export function runMigrations(migrationsFolder: string = config.migrationsFolder): void {
  migrate(db, { migrationsFolder });
}

/** Ciò che SQLite riporta al termine di un checkpoint. */
interface WalCheckpointRow {
  readonly busy: number;
  readonly log: number;
  readonly checkpointed: number;
}

export interface DatabaseCloseOutcome {
  /** Il WAL è stato consolidato nel file principale. */
  readonly checkpointed: boolean;
  /** Pagine rimaste nel WAL: zero dopo un troncamento riuscito. */
  readonly walPages: number;
  /**
   * Pagine ancora da trasferire.
   *
   * In modalità `TRUNCATE` SQLite azzera il WAL, quindi a operazione riuscita
   * vale zero: non è la quantità di dati spostati, è ciò che resta indietro.
   */
  readonly movedPages: number;
  /** La connessione era già stata chiusa. */
  readonly alreadyClosed: boolean;
}

let closed = false;

/**
 * Chiude la connessione consolidando il WAL.
 *
 * `TRUNCATE` e non `PASSIVE`: sposta tutto il contenuto del WAL nel file
 * principale e poi azzera il WAL. È ciò che rende il database **un file
 * singolo e copiabile**, cioè il requisito su cui poggia l'intera
 * portabilità: senza questo passaggio i dati restano nel file `-wal`, e
 * copiare il solo `.sqlite` significa perderli.
 *
 * `close()` da solo eseguirebbe un checkpoint passivo e rimuoverebbe il WAL,
 * ma soltanto se è l'ultima connessione e senza garanzie in presenza di
 * lettori attivi. Farlo in modo esplicito rende l'esito osservabile: `busy`
 * dice se il consolidamento è davvero avvenuto.
 */
export function closeDatabase(): DatabaseCloseOutcome {
  if (closed) {
    return { checkpointed: true, walPages: 0, movedPages: 0, alreadyClosed: true };
  }
  closed = true;

  const rows = sqlite.pragma('wal_checkpoint(TRUNCATE)') as WalCheckpointRow[];
  const result = rows[0];

  sqlite.close();

  return {
    checkpointed: result?.busy === 0,
    walPages: result?.log ?? -1,
    movedPages: result?.checkpointed ?? -1,
    alreadyClosed: false,
  };
}
