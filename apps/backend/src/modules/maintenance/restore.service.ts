import { copyFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { compareSchema, readAppSchema } from '../../db/schema-version.js';
import { ConflictError, ValidationError } from '../../shared/errors.js';
import { ensureDataDirectories } from '../../paths.js';
import { logger } from '../../shared/logger.js';
import { inspectDatabase, sha256OfFile } from './backup.manifest.js';
import { BackupFailedError, backupService } from './backup.service.js';
import {
  CANDIDATE_FILE,
  RESTORE_FORMAT,
  clearPendingRestore,
  readPendingRestore,
  writePendingRestore,
  type PendingRestore,
} from './restore-pending.js';

/**
 * La preparazione di un ripristino.
 *
 * Questa metà gira mentre l'applicazione è in funzione e **non sostituisce
 * niente**: il database attivo ha una connessione aperta, e scambiarlo adesso
 * significherebbe togliere il file da sotto i piedi di SQLite. Ciò che fa è
 * mettere tutto in ordine perché lo scambio possa avvenire all'avvio
 * successivo, quando nessuna connessione esiste:
 *
 *     verifica il backup
 *         -> controlla la compatibilità dello schema
 *         -> crea il backup dell'archivio corrente
 *         -> copia il candidato in tmp/
 *         -> ricontrolla la copia
 *         -> scrive restore-pending.json
 *
 * Ogni passo può fermare la sequenza, e fermarla non costa nulla: finché
 * `restore-pending.json` non esiste, non è stato deciso niente.
 */

export interface StagedRestore {
  readonly backupName: string;
  /** Il backup dell'archivio che verrà sostituito. */
  readonly preRestoreBackup: string;
  readonly stagedAt: string;
  /** Le righe che il ripristino porterà, per tabella. */
  readonly rowCounts: Record<string, number>;
}

export const restoreService = {
  /** Il ripristino in attesa, se ce n'è uno. */
  pending(): PendingRestore | null {
    const marker = readPendingRestore(config.dataRoot);

    return marker !== null && marker.ok ? marker.pending : null;
  },

  /**
   * Prepara il ripristino dal backup indicato.
   *
   * `moment` è un parametro perché il nome del backup pre-restore dipende
   * dall'orologio.
   */
  stage(name: string, moment: Date = new Date()): StagedRestore {
    ensureDataDirectories();

    const existing = readPendingRestore(config.dataRoot);
    if (existing !== null && existing.ok && existing.pending.state === 'applying') {
      throw new ConflictError(
        "Un ripristino è già in corso di applicazione: riavvia l'applicazione prima di chiederne un altro.",
      );
    }

    // 1. Il backup deve essere un backup: manifest, integrità, impronta.
    const check = backupService.verify(name);
    if (!check.ok) {
      throw new ValidationError(check.problem);
    }

    // 2. Uno schema più recente dell'applicazione non si ripristina: sarebbe
    //    un downgrade mascherato da ripristino.
    if (compareSchema(check.schema, readAppSchema(config.migrationsFolder)) === 'database-piu-recente') {
      throw new ValidationError(
        `Il backup "${name}" è stato creato da una versione più recente di appConto e questa versione non può aprirlo in sicurezza. L'archivio attuale non è stato modificato.`,
      );
    }

    // 3. L'archivio corrente si mette in salvo *prima* di preparare la sua
    //    sostituzione. Se questo passo non riesce, il ripristino non comincia.
    let preRestoreBackup: string;
    try {
      preRestoreBackup = backupService.create('pre-restore', moment).name;
    } catch (error) {
      const detail = error instanceof BackupFailedError ? error.message : 'errore sconosciuto';
      logger.error('Ripristino non preparato: backup dell\'archivio corrente non riuscito', {
        backup: name,
      });

      throw new Error(
        `Impossibile mettere al sicuro l'archivio attuale, quindi il ripristino non è stato preparato. ${detail}`,
      );
    }

    // 4. Il candidato viene copiato, non spostato: il backup deve restare dov'è.
    const candidate = path.join(config.tmpDir, CANDIDATE_FILE);
    rmSync(candidate, { force: true });
    copyFileSync(check.file, candidate);

    // 5. La copia si ricontrolla: è un file diverso da quello verificato al
    //    passo 1, e sarà lui a diventare l'archivio.
    const inspection = inspectDatabase(candidate);
    if (!inspection.ok || sha256OfFile(candidate) !== check.sha256) {
      rmSync(candidate, { force: true });

      throw new Error(
        `La copia del backup non ha superato la verifica, quindi il ripristino non è stato preparato: ${
          inspection.ok ? "l'impronta della copia non corrisponde." : inspection.problem
        }`,
      );
    }

    const pending: PendingRestore = {
      format: RESTORE_FORMAT,
      state: 'staged',
      stagedAt: moment.toISOString(),
      backupName: name,
      candidateFile: CANDIDATE_FILE,
      databaseSha256: check.sha256,
      preRestoreBackup,
      replacedFile: null,
    };

    writePendingRestore(config.dataRoot, pending);

    logger.info('Ripristino preparato: sarà applicato al prossimo avvio', {
      backup: name,
      backupPreRestore: preRestoreBackup,
      righe: check.rowCounts,
    });

    return {
      backupName: name,
      preRestoreBackup,
      stagedAt: pending.stagedAt,
      rowCounts: check.rowCounts,
    };
  },

  /**
   * Annulla un ripristino preparato e non ancora applicato.
   *
   * Il backup pre-restore già creato resta dov'è: è una copia in più
   * dell'archivio corrente, e cancellarla per "pulizia" significherebbe
   * distruggere un dato buono. La ritenzione se ne occuperà a suo tempo.
   */
  cancel(): boolean {
    const marker = readPendingRestore(config.dataRoot);
    if (marker === null) {
      return false;
    }

    if (marker.ok && marker.pending.state === 'applying') {
      throw new ConflictError(
        "Un ripristino è già in corso di applicazione e non può essere annullato: riavvia l'applicazione.",
      );
    }

    const candidate = path.join(config.tmpDir, CANDIDATE_FILE);
    if (existsSync(candidate)) {
      rmSync(candidate, { force: true });
    }

    clearPendingRestore(config.dataRoot);
    logger.info('Ripristino annullato su richiesta');

    return true;
  },
};
