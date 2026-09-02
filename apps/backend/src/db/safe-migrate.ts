import { compareSchema, type SchemaVersion } from './schema-version.js';

/**
 * L'unica sequenza autorizzata a modificare lo schema del database.
 *
 *     confronto  ->  rifiuto o backup  ->  migrazione
 *
 * Le tre decisioni che contengono sono di sicurezza, non di comodità:
 *
 *  1. un archivio più recente dell'applicazione **non viene aperto**;
 *  2. una migrazione **non parte** se il backup non è riuscito;
 *  3. un database appena creato non richiede backup, perché non contiene nulla
 *     da perdere.
 *
 * La logica riceve le sue dipendenze invece di importarle. Non è un ossequio a
 * uno schema: le tre condizioni che deve garantire sono difficili da provocare
 * su un database vero — servirebbe una versione futura dell'applicazione, un
 * disco pieno, una migrazione rotta — e diventano banali da verificare quando
 * il confine è una funzione.
 */

/**
 * Il database appartiene a una versione più recente: non si apre.
 *
 * Su dati finanziari un adattamento silenzioso è inaccettabile. Una versione
 * precedente dell'applicazione non conosce le colonne aggiunte dopo di sé:
 * scriverebbe righe incomplete, e le scriverebbe senza accorgersene.
 */
export class SchemaTooNewError extends Error {}

/** Il backup obbligatorio non è riuscito: la migrazione non è stata tentata. */
export class PreMigrationBackupError extends Error {}

/** La migrazione è fallita. Il backup precedente esiste ed è verificato. */
export class MigrationFailedError extends Error {
  constructor(
    message: string,
    /** Il backup da cui si può ripartire. */
    readonly backupName: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Ciò di cui la sequenza ha bisogno dal mondo esterno. */
export interface MigrationPort {
  /** La versione registrata nel database. */
  readonly databaseSchema: () => SchemaVersion;
  /** La versione che l'applicazione porta con sé. */
  readonly appSchema: () => SchemaVersion;
  /** Crea un backup verificato e ne restituisce il nome. Solleva se non riesce. */
  readonly createBackup: () => string;
  /** Applica le migrazioni mancanti. */
  readonly migrate: () => void;
}

export type MigrationOutcome =
  /** Il database era vuoto: lo schema è stato creato da zero. */
  | { readonly kind: 'inizializzato'; readonly schema: SchemaVersion }
  /** Nulla da fare. */
  | { readonly kind: 'allineato'; readonly schema: SchemaVersion }
  /** Migrazioni applicate, con il backup creato prima di toccare lo schema. */
  | {
      readonly kind: 'migrato';
      readonly from: SchemaVersion;
      readonly to: SchemaVersion;
      readonly backupName: string;
    };

/** Il messaggio del rifiuto, in forma comprensibile a chi non conosce Drizzle. */
function tooNewMessage(database: SchemaVersion, app: SchemaVersion): string {
  return [
    'Questo archivio è stato creato da una versione più recente di appConto.',
    `Contiene ${String(database.appliedCount)} aggiornamenti dello schema, questa versione ne conosce ${String(app.appliedCount)}.`,
    "Aprirlo con questa versione significherebbe scrivere dati incompleti, quindi l'applicazione si ferma.",
    "L'archivio NON è stato modificato: per usarlo, installa di nuovo la versione più recente dell'applicazione.",
  ].join(' ');
}

/**
 * Porta lo schema del database alla versione dell'applicazione, o si ferma.
 *
 * Il backup viene creato solo quando c'è davvero una migrazione da applicare:
 * farlo ad ogni avvio riempirebbe il disco di copie identiche e renderebbe
 * lento il caso normale, che è "non c'è niente da fare".
 */
export function safeMigrate(port: MigrationPort): MigrationOutcome {
  const before = port.databaseSchema();
  const app = port.appSchema();

  switch (compareSchema(before, app)) {
    case 'database-piu-recente':
      throw new SchemaTooNewError(tooNewMessage(before, app));

    case 'allineato':
      return { kind: 'allineato', schema: before };

    case 'nuovo': {
      // Un file appena creato non ha nulla da proteggere: il backup
      // riguarderebbe un database vuoto.
      port.migrate();

      return { kind: 'inizializzato', schema: port.databaseSchema() };
    }

    case 'da-migrare': {
      let backupName: string;
      try {
        backupName = port.createBackup();
      } catch (error) {
        // Il punto centrale di questo modulo: nessuna migrazione senza rete.
        throw new PreMigrationBackupError(
          `Impossibile creare il backup obbligatorio prima della migrazione, quindi la migrazione non è stata eseguita e l'archivio non è stato modificato. ${
            error instanceof Error ? error.message : 'Errore sconosciuto.'
          }`,
        );
      }

      try {
        port.migrate();
      } catch (error) {
        throw new MigrationFailedError(
          `Aggiornamento dello schema non riuscito: ${
            error instanceof Error ? error.message : 'errore sconosciuto'
          }. Lo schema è stato riportato allo stato precedente ed esiste un backup verificato: ${backupName}`,
          backupName,
        );
      }

      return { kind: 'migrato', from: before, to: port.databaseSchema(), backupName };
    }
  }
}
