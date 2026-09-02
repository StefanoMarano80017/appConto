import { config } from '../../config.js';
import { logger } from '../../shared/logger.js';
import { createBackupScheduler, type BackupScheduler } from './backup.scheduler.js';
import { backupService } from './backup.service.js';

/**
 * Lo scheduler dei backup automatici, collegato alle parti reali.
 *
 * Sta qui e non in `main.ts` perché il cablaggio è materia della feature:
 * chi compone l'avvio deve poter scrivere una riga sola. E sta fuori da
 * `backup.scheduler.ts` perché quel modulo non deve conoscere né la
 * configurazione né il logger — è la condizione che lo rende verificabile
 * senza creare un file né aspettare un giorno.
 */

/** Quanto si attende dopo l'avvio prima del primo backup automatico. */
const SETTLE_MS = 30_000;

export function createAutoBackupScheduler(): BackupScheduler {
  return createBackupScheduler({
    intervalMs: config.autoBackupIntervalMs,
    /*
     * Il margine non può superare l'intervallo.
     *
     * Trenta secondi tengono il primo backup fuori dalla finestra di avvio —
     * migrazioni, backfill, prima schermata — e con la cadenza giornaliera
     * predefinita sono nulla. Ma con un intervallo più corto del margine, il
     * margine diventerebbe l'intervallo, e la cadenza chiesta non sarebbe
     * rispettata. Da qui il minimo, che è anche ciò che rende osservabile lo
     * scheduler in un test senza un valore riservato ai test.
     */
    settleMs: Math.min(SETTLE_MS, config.autoBackupIntervalMs),
    list: () => backupService.list(),
    // La stessa chiamata dell'endpoint HTTP: `VACUUM INTO`, verifica e
    // ritenzione esistono una volta sola, in `backupService`.
    create: () => backupService.create('auto'),
    now: () => new Date(),
    onEvent: (event) => {
      switch (event.kind) {
        case 'disattivato':
          logger.info('Backup automatici disattivati dalla configurazione');
          break;

        case 'programmato':
          logger.info('Prossimo backup automatico programmato', {
            fraMinuti: Math.round(event.delayMs / 60_000),
            ogniOre: Number((event.intervalMs / 3_600_000).toFixed(3)),
          });
          break;

        case 'creato':
          logger.info('Backup automatico creato', { nome: event.name, byte: event.bytes });
          break;

        case 'fallito':
          // Non è un guasto dell'applicazione: `backupService` non lascia
          // file a metà, e al prossimo intervallo si riprova.
          logger.error(`Backup automatico non riuscito: ${event.problem}`);
          break;

        case 'fermato':
          logger.info('Backup automatici fermati');
          break;
      }
    },
  });
}
