import type { BackupInfo } from './backup.service.js';
import type { BackupKind } from './backup.naming.js';
import type { PendingRestore } from './restore-pending.js';

/**
 * Come i backup si presentano alle API.
 *
 * La traduzione non è decorativa: quello che il servizio conosce comprende
 * percorsi assoluti e chiavi di ordinamento interne, e nessuna delle due cose
 * ha motivo di uscire. Verso l'esterno un backup è un nome, una data e cosa
 * contiene — quanto basta per scegliere quale ripristinare.
 */

export interface BackupDto {
  name: string;
  kind: BackupKind;
  /** L'istante esatto in ISO UTC, se il manifest lo dichiara. */
  createdAt: string | null;
  /** L'ora locale ricavata dal nome: sempre presente. */
  localTime: string;
  sizeBytes: number;
  appVersion: string | null;
  /**
   * Quanti aggiornamenti dello schema contiene.
   *
   * È il numero di migrazioni applicate: l'unica parte della versione dello
   * schema che significhi qualcosa per chi legge. L'istante interno usato per
   * ordinarle resta dentro.
   */
  schemaVersion: number | null;
  rowCounts: Record<string, number>;
  status: BackupInfo['status'];
  problem: string | null;
}

export interface PendingRestoreDto {
  backupName: string;
  stagedAt: string;
  /** Il backup dell'archivio che verrà sostituito. */
  preRestoreBackup: string;
  /** Il ripristino avverrà al prossimo avvio: finché non riavvii non cambia nulla. */
  restartRequired: boolean;
}

export interface BackupsDto {
  backups: BackupDto[];
  pendingRestore: PendingRestoreDto | null;
}

export function toBackupDto(info: BackupInfo): BackupDto {
  return {
    name: info.name,
    kind: info.kind,
    createdAt: info.createdAt,
    localTime: info.localTime,
    sizeBytes: info.bytes,
    appVersion: info.appVersion,
    schemaVersion: info.schemaVersion?.appliedCount ?? null,
    rowCounts: info.rowCounts,
    status: info.status,
    problem: info.problem,
  };
}

export function toPendingRestoreDto(pending: PendingRestore): PendingRestoreDto {
  return {
    backupName: pending.backupName,
    stagedAt: pending.stagedAt,
    preRestoreBackup: pending.preRestoreBackup,
    restartRequired: true,
  };
}
