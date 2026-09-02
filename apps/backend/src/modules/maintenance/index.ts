/** API pubblica della feature `maintenance`: backup, verifica e ripristino. */
export {
  BACKUP_KINDS,
  parseBackupName,
  resolveBackupFile,
  type BackupKind,
} from './backup.naming.js';
export { RETENTION, backupsToPrune, isoWeekKey } from './backup.retention.js';
export {
  BACKUP_FORMAT,
  inspectDatabase,
  parseManifest,
  sha256OfFile,
  type BackupManifest,
} from './backup.manifest.js';
export { BackupFailedError, backupService, type BackupCheck, type BackupInfo } from './backup.service.js';
export { createAutoBackupScheduler } from './auto-backup.js';
export {
  createBackupScheduler,
  momentOf,
  newestAuto,
  nextDelayMs,
  type BackupScheduler,
  type SchedulerEvent,
  type SchedulerPort,
} from './backup.scheduler.js';
export {
  applyPendingRestore,
  readPendingRestore,
  type PendingRestore,
  type RestoreOutcome,
} from './restore-pending.js';
export { restoreService, type StagedRestore } from './restore.service.js';
export { backupsRouter, restoreRouter } from './maintenance.routes.js';
export { toBackupDto, type BackupDto, type BackupsDto } from './maintenance.view-model.js';
