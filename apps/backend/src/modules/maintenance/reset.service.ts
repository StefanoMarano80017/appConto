import { sql } from 'drizzle-orm';
import { config } from '../../config.js';
import { atomically, db, vacuum } from '../../db/client.js';
import { ConflictError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { CATEGORY_SEED } from '../categories/categories.seed.js';
import { SETTINGS_ID } from '../settings/settings.schema.js';
import { backupService } from './backup.service.js';
import { readPendingRestore } from './restore-pending.js';

/**
 * Azzerare l'archivio: tornare allo stato del primo avvio.
 *
 * È l'operazione più distruttiva che questa applicazione permette, e per questo
 * l'ordine dei passaggi è la garanzia:
 *
 *     backup verificato  ->  svuotamento  ->  seed  ->  ricompattazione
 *
 * Il backup è **la condizione per procedere**, non un accompagnamento: se non
 * riesce, l'archivio non viene toccato. È lo stesso principio del backup
 * obbligatorio prima di una migrazione (WP-P3), applicato all'unico altro
 * momento in cui l'applicazione cancella dati che l'utente non ha eliminato
 * uno per uno.
 *
 * ## Cosa resta
 *
 * Lo **schema** e il registro delle migrazioni: azzerare i dati non è tornare
 * a una versione precedente del programma, e riapplicare le migrazioni non
 * avrebbe senso. I **backup** restano tutti dove sono — compreso quello appena
 * creato, che la ritenzione non elimina mai. I **log** restano: raccontano
 * anche questo azzeramento.
 *
 * ## Cosa torna come al primo avvio
 *
 * Ogni tabella dell'applicazione viene svuotata, e le righe che una
 * installazione nuova ha vengono reinserite: le ventidue categorie iniziali e
 * l'unica riga delle impostazioni, con saldo di partenza sconosciuto.
 */

/** L'archivio non è stato azzerato. */
export class ResetFailedError extends Error {}

export interface ResetOutcome {
  /** Il backup creato prima di procedere: da lì si torna indietro. */
  readonly backupName: string;
  /** Quante righe sono state eliminate, per tabella. */
  readonly removed: Record<string, number>;
  readonly seededCategories: number;
}

/**
 * Le tabelle dei dati dell'utente, chieste al database.
 *
 * Chieste e non elencate a mano: un elenco scritto qui resterebbe indietro alla
 * prima tabella aggiunta, e un azzeramento che dimentica una tabella è un
 * guasto silenzioso — l'utente crede di essere ripartito da zero e non lo è.
 *
 * Le tabelle di servizio sono escluse con la stessa regola usata dal manifest
 * dei backup: il doppio trattino basso non è un dato dell'utente. È anche ciò
 * che protegge `__drizzle_migrations`, cioè la versione dello schema.
 */
export function userTables(): string[] {
  const rows = db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
  );

  return rows.map((row) => row.name).filter((name) => !name.startsWith('__'));
}

/** Quante righe contiene una tabella. */
function countRows(table: string): number {
  const row = db.get<{ total: number }>(sql`select count(*) as total from ${sql.identifier(table)}`);

  return Number(row?.total ?? 0);
}

export const resetService = {
  /**
   * Azzera l'archivio e restituisce il conto di ciò che è stato eliminato.
   *
   * `moment` è un parametro perché il nome del backup dipende dall'orologio, e
   * un test deve poterlo fissare.
   */
  run(moment: Date = new Date()): ResetOutcome {
    /*
     * Un ripristino in attesa vincerebbe su questo azzeramento.
     *
     * Il file preparato dal ripristino verrà messo al posto del database al
     * prossimo avvio, cancellando l'effetto dell'azzeramento senza che nessuno
     * se ne accorga. Le due operazioni sono entrambe legittime, ma non
     * insieme: si dice quale annullare.
     */
    if (readPendingRestore(config.dataRoot) !== null) {
      throw new ConflictError(
        "C'è un ripristino in attesa del prossimo avvio: verrebbe applicato dopo l'azzeramento, annullandolo. Annulla il ripristino, oppure riavvia l'applicazione per applicarlo, e poi riprova.",
      );
    }

    const tables = userTables();

    // Il conto si prende prima: dopo lo svuotamento non c'è più niente da
    // contare, e ciò che si riporta all'utente è quanto è stato eliminato.
    const removed: Record<string, number> = {};
    for (const table of tables) {
      removed[table] = countRows(table);
    }

    let backupName: string;
    try {
      backupName = backupService.create('pre-reset', moment).name;
    } catch (error) {
      // L'archivio non è stato toccato: è la prima cosa da dire.
      throw new ResetFailedError(
        `L'archivio non è stato azzerato perché non è stato possibile crearne prima una copia di sicurezza: ${
          error instanceof Error ? error.message : 'errore sconosciuto'
        }`,
      );
    }

    atomically(() => {
      /*
       * I vincoli di integrità si verificano al commit, non a ogni istruzione.
       *
       * Le tabelle si riferiscono l'una all'altra — un prestito indica una
       * transazione, una transazione indica un merchant — quindi svuotarle in
       * ordine alfabetico violerebbe un vincolo a metà strada.
       * `defer_foreign_keys` sposta il controllo alla fine della transazione,
       * dove tutto è vuoto e niente resta appeso. È anche una rete: se qualcosa
       * restasse appeso, il commit fallirebbe e l'archivio tornerebbe intero.
       *
       * Non `foreign_keys = OFF`, che dentro una transazione non ha effetto — e
       * che disattiverebbe il controllo invece di rinviarlo.
       */
      db.run(sql`PRAGMA defer_foreign_keys = ON`);

      for (const table of tables) {
        db.run(sql`delete from ${sql.identifier(table)}`);
      }

      for (const category of CATEGORY_SEED) {
        db.run(
          sql`insert into categories (id, name, color) values (${category.id}, ${category.name}, ${category.color})`,
        );
      }

      // La riga unica delle impostazioni, come la crea la migrazione: saldo di
      // partenza sconosciuto.
      db.run(
        sql`insert into settings (id, initial_balance_cents, balance_date) values (${SETTINGS_ID}, 0, null)`,
      );
    });

    /*
     * Fuori dalla transazione, perché SQLite riscrive l'intero file.
     *
     * Senza questo passaggio il database resterebbe della dimensione di prima,
     * con dentro lo spazio delle righe cancellate: «da zero» sarebbe vero nei
     * dati e falso sul disco.
     */
    vacuum();

    logger.info('Archivio azzerato', { backup: backupName, eliminate: removed });

    return { backupName, removed, seededCategories: CATEGORY_SEED.length };
  },
};
