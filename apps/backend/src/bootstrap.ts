import { config } from './config.js';
import { databaseSchema, runMigrations } from './db/client.js';
import { safeMigrate, type MigrationOutcome } from './db/safe-migrate.js';
import { readAppSchema } from './db/schema-version.js';
import { backupService } from './modules/maintenance/index.js';
import { transactionsService } from './modules/transactions/index.js';
import { logger } from './shared/logger.js';

/**
 * Prepara l'archivio prima che il server accetti richieste.
 *
 * È la radice di composizione del ciclo di vita dei dati, come `app.ts` lo è
 * per quello HTTP: qui si incontrano la guardia sullo schema, il backup
 * obbligatorio e le migrazioni, e nessuna di quelle parti conosce le altre.
 *
 * L'applicazione del ripristino differito **non** è qui: avviene un istante
 * prima, all'apertura della connessione in `db/client.ts`, perché è l'unico
 * momento in cui il file del database non è aperto da nessuno.
 *
 * Solleva un'eccezione se l'avvio non è sicuro. Chi la riceve non ha
 * alternative da valutare: l'unica risposta corretta è non partire.
 */
export function bootstrap(migrationsFolder: string = config.migrationsFolder): MigrationOutcome {
  const outcome = safeMigrate({
    databaseSchema,
    appSchema: () => readAppSchema(migrationsFolder),
    // Il backup è l'unica condizione per procedere: `create` solleva se il
    // file non supera la verifica, e `safeMigrate` in quel caso non migra.
    createBackup: () => backupService.create('pre-migration').name,
    migrate: () => {
      runMigrations(migrationsFolder);
    },
  });

  switch (outcome.kind) {
    case 'inizializzato':
      logger.info('Archivio creato', { migrazioni: outcome.schema.appliedCount });
      break;

    case 'allineato':
      logger.info('Archivio aggiornato', { migrazioni: outcome.schema.appliedCount });
      break;

    case 'migrato':
      logger.info('Archivio migrato', {
        da: outcome.from.appliedCount,
        a: outcome.to.appliedCount,
        backup: outcome.backupName,
      });
      break;
  }

  // Il fingerprint non è calcolabile in SQL: le transazioni importate prima
  // della sua introduzione vengono completate qui, una sola volta.
  const backfilled = transactionsService.backfillFingerprints();
  if (backfilled > 0) {
    logger.info(`Fingerprint calcolato per ${String(backfilled)} transazioni preesistenti`);
  }

  return outcome;
}
