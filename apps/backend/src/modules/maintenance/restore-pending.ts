import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { compareSchema, readAppSchema } from '../../db/schema-version.js';
import { logger } from '../../shared/logger.js';
import { inspectDatabase, sha256OfFile } from './backup.manifest.js';

/**
 * Il ripristino differito.
 *
 * Un database SQLite non si sostituisce mentre è aperto. Il momento giusto per
 * scambiare il file è l'unico istante in cui nessuna connessione esiste: prima
 * che l'applicazione lo apra. Perciò il ripristino avviene in due tempi — la
 * richiesta HTTP *prepara*, l'avvio successivo *applica* — e fra i due c'è un
 * file di stato, `restore-pending.json`, che sopravvive allo spegnimento.
 *
 * Questo modulo è la metà che gira all'avvio, e non conosce né la connessione
 * attiva né il resto dell'applicazione: è ciò che gli permette di essere
 * chiamato dal client SQLite un istante prima che il database venga aperto.
 *
 * ## Punto di commit
 *
 * La procedura non è atomica — nessun filesystem offre lo scambio di due file
 * in un colpo solo — quindi ha un punto di commit dichiarato:
 *
 *     1. il marcatore passa a "applying"      ← da qui in poi è ricostruibile
 *     2. database.sqlite  → tmp/replaced-<data>.sqlite
 *     3. -wal e -shm del vecchio database vengono rimossi
 *     4. tmp/restore-candidate.sqlite → database.sqlite   ← PUNTO DI COMMIT
 *     5. il marcatore viene rimosso
 *
 * Un'interruzione fra il passo 2 e il passo 4 lascia il marcatore in
 * "applying": l'avvio successivo lo vede, capisce dallo stato del disco a che
 * punto era arrivato e completa o torna indietro. Nessun passaggio distrugge
 * dati: il database precedente resta in `tmp/`, e il backup pre-restore è già
 * in `backups/`.
 *
 * ## Percorsi relativi
 *
 * Nel marcatore i file sono nominati **relativamente** a `DATA_ROOT`. Un
 * percorso assoluto renderebbe il file di stato valido solo dove è stato
 * scritto, e la cartella dei dati deve poter essere copiata altrove anche con
 * un ripristino in sospeso.
 */

/** Il nome del marcatore, dentro `DATA_ROOT`. */
export const PENDING_RESTORE_FILE = 'restore-pending.json';

/** Il formato riconosciuto del marcatore. */
export const RESTORE_FORMAT = 'appconto-restore/1';

/** Il nome del database preparato, dentro `tmp/`. */
export const CANDIDATE_FILE = 'restore-candidate.sqlite';

/** Quante copie del database sostituito si conservano in `tmp/`. */
const REPLACED_TO_KEEP = 2;

export type PendingRestoreState = 'staged' | 'applying';

export interface PendingRestore {
  readonly format: string;
  readonly state: PendingRestoreState;
  /** Quando la richiesta è stata preparata, in ISO UTC. */
  readonly stagedAt: string;
  /** Il backup da cui il ripristino proviene. */
  readonly backupName: string;
  /** Il database preparato, relativo a `tmp/`. */
  readonly candidateFile: string;
  /** L'impronta attesa del database preparato. */
  readonly databaseSha256: string;
  /** Il backup dell'archivio corrente, creato prima di preparare il ripristino. */
  readonly preRestoreBackup: string;
  /** Dove è stato spostato il database sostituito, relativo a `tmp/`. */
  readonly replacedFile: string | null;
}

/** I percorsi che la procedura tocca. Espliciti, per poterla provare altrove. */
export interface RestoreLocations {
  readonly dataRoot: string;
  readonly databaseFile: string;
  readonly tmpDir: string;
  readonly migrationsFolder: string;
}

export type RestoreOutcome =
  /** Nessun ripristino era in attesa. */
  | { readonly kind: 'nessuno' }
  /** Il database è stato sostituito. */
  | { readonly kind: 'applicato'; readonly backupName: string; readonly replacedFile: string }
  /** Un'applicazione interrotta si era in realtà conclusa: resta solo da archiviare. */
  | { readonly kind: 'gia-applicato'; readonly backupName: string }
  /** L'applicazione era stata interrotta a metà: l'archivio precedente è tornato al suo posto. */
  | { readonly kind: 'recuperato'; readonly problem: string }
  /** La richiesta non era accettabile: l'archivio corrente non è stato toccato. */
  | { readonly kind: 'rifiutato'; readonly problem: string };

export function pendingRestoreFile(dataRoot: string): string {
  return path.join(dataRoot, PENDING_RESTORE_FILE);
}

/** Il valore, se è una stringa non vuota. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Legge il marcatore.
 *
 * `null` significa "non c'è". Un file presente ma inutilizzabile è un altro
 * caso, e va distinto: significa che un ripristino era stato chiesto e non si
 * può eseguire, cosa che l'utente deve sapere.
 */
export function readPendingRestore(
  dataRoot: string,
): { readonly ok: true; readonly pending: PendingRestore } | { readonly ok: false; readonly problem: string } | null {
  const file = pendingRestoreFile(dataRoot);
  if (!existsSync(file)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { ok: false, problem: 'il file di stato del ripristino non è JSON valido.' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, problem: 'il file di stato del ripristino non è un oggetto JSON.' };
  }

  const raw = parsed as Record<string, unknown>;
  const format = text(raw.format);
  const state = text(raw.state);
  const backupName = text(raw.backupName);
  const candidateFile = text(raw.candidateFile);
  const databaseSha256 = text(raw.databaseSha256);

  if (format !== RESTORE_FORMAT) {
    return { ok: false, problem: `formato del file di stato non supportato: "${String(format)}".` };
  }

  if (state !== 'staged' && state !== 'applying') {
    return { ok: false, problem: `stato del ripristino non riconosciuto: "${String(state)}".` };
  }

  if (backupName === null || candidateFile === null || databaseSha256 === null) {
    return { ok: false, problem: 'il file di stato del ripristino è incompleto.' };
  }

  return {
    ok: true,
    pending: {
      format,
      state,
      stagedAt: text(raw.stagedAt) ?? 'sconosciuto',
      backupName,
      candidateFile,
      databaseSha256,
      preRestoreBackup: text(raw.preRestoreBackup) ?? 'nessuno',
      replacedFile: text(raw.replacedFile),
    },
  };
}

export function writePendingRestore(dataRoot: string, pending: PendingRestore): void {
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(pendingRestoreFile(dataRoot), `${JSON.stringify(pending, null, 2)}\n`, 'utf8');
}

export function clearPendingRestore(dataRoot: string): void {
  rmSync(pendingRestoreFile(dataRoot), { force: true });
}

/**
 * Mette da parte un marcatore inutilizzabile.
 *
 * Non viene cancellato: dice che un ripristino era stato chiesto e non è
 * avvenuto, e quella traccia serve a chi legge i log. Non resta però al suo
 * posto, altrimenti ogni avvio successivo ritenterebbe la stessa cosa.
 */
function quarantine(dataRoot: string): void {
  const target = path.join(dataRoot, 'restore-pending.invalid.json');
  try {
    rmSync(target, { force: true });
    renameSync(pendingRestoreFile(dataRoot), target);
  } catch {
    // Se non si riesce nemmeno a spostarlo lo si rimuove: un marcatore che
    // resta è un ripristino che si ritenta all'infinito.
    rmSync(pendingRestoreFile(dataRoot), { force: true });
  }
}

/** `replaced-YYYYMMDD-HHmmss.sqlite`: ordinabile, come i backup. */
function replacedName(moment: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = `${String(moment.getFullYear())}${pad(moment.getMonth() + 1)}${pad(moment.getDate())}`;
  const time = `${pad(moment.getHours())}${pad(moment.getMinutes())}${pad(moment.getSeconds())}`;

  return `replaced-${day}-${time}.sqlite`;
}

/** Conserva solo le ultime copie del database sostituito, `-wal` compreso. */
function pruneReplaced(tmpDir: string): void {
  try {
    const found = readdirSync(tmpDir)
      .filter((name) => /^replaced-\d{8}-\d{6}\.sqlite$/.test(name))
      .sort()
      .reverse();

    for (const name of found.slice(REPLACED_TO_KEEP)) {
      rmSync(path.join(tmpDir, name), { force: true });
      rmSync(path.join(tmpDir, `${name}-wal`), { force: true });
    }
  } catch {
    // La pulizia è un'igiene, non una garanzia: non deve far fallire l'avvio.
  }
}

/**
 * Sposta il `-wal` insieme al database che accompagna.
 *
 * Non lo cancella. In modalità WAL le scritture recenti vivono lì, e se
 * l'applicazione è stata chiusa in modo brusco — su Windows `process.kill`
 * termina il processo senza consegnare il segnale, quindi il consolidamento
 * non avviene — quel file contiene dati confermati e non ancora trasferiti.
 * Cancellarlo renderebbe incompleta la copia di sicurezza proprio nel momento
 * in cui potrebbe servire.
 *
 * Il `-shm` invece si butta: è memoria condivisa ricostruibile.
 */
function moveSidecars(databaseFile: string, destination: string | null): void {
  const wal = `${databaseFile}-wal`;

  if (destination !== null && existsSync(wal)) {
    try {
      renameSync(wal, `${destination}-wal`);
    } catch {
      // Se non si riesce a spostarlo va rimosso comunque: il passo successivo
      // lo esige, e la copia di sicurezza vera è il backup pre-restore.
    }
  }

  // Qualunque residuo deve sparire **prima** dello scambio: un `-wal` rimasto
  // accanto al nome `database.sqlite` verrebbe attribuito all'archivio nuovo,
  // e SQLite lo applicherebbe a un file a cui non appartiene.
  rmSync(wal, { force: true });
  rmSync(`${databaseFile}-shm`, { force: true });
}

/**
 * Sostituisce il database con il candidato già verificato.
 *
 * È la parte che tocca i file, isolata perché il suo fallimento ha un rimedio
 * preciso: se il database corrente è già stato spostato via e lo scambio non
 * si completa, va rimesso al suo posto.
 */
function swap(
  locations: RestoreLocations,
  pending: PendingRestore,
  candidate: string,
  now: Date,
): { readonly replacedFile: string | null } {
  const replaced = existsSync(locations.databaseFile) ? replacedName(now) : null;

  writePendingRestore(locations.dataRoot, { ...pending, state: 'applying', replacedFile: replaced });

  mkdirSync(locations.tmpDir, { recursive: true });
  const destination = replaced === null ? null : path.join(locations.tmpDir, replaced);

  if (destination !== null) {
    renameSync(locations.databaseFile, destination);
  }

  moveSidecars(locations.databaseFile, destination);

  // PUNTO DI COMMIT: da qui il ripristino è avvenuto.
  renameSync(candidate, locations.databaseFile);

  return { replacedFile: replaced };
}

/**
 * Verifica il candidato con la stessa severità usata al momento della richiesta.
 *
 * Di nuovo, e non una volta sola: fra la preparazione e l'avvio successivo
 * passa uno spegnimento, e in quell'intervallo il file può essere stato
 * troncato da un disco pieno o l'applicazione può essere stata sostituita con
 * una versione più vecchia dello schema.
 */
function verifyCandidate(
  locations: RestoreLocations,
  pending: PendingRestore,
  candidate: string,
): string | null {
  const inspection = inspectDatabase(candidate);
  if (!inspection.ok) {
    return `il database preparato non è utilizzabile: ${inspection.problem}`;
  }

  if (sha256OfFile(candidate) !== pending.databaseSha256) {
    return "l'impronta del database preparato non corrisponde a quella registrata.";
  }

  const comparison = compareSchema(inspection.schema, readAppSchema(locations.migrationsFolder));
  if (comparison === 'database-piu-recente') {
    return 'il database preparato appartiene a una versione più recente dell\'applicazione.';
  }

  return null;
}

/**
 * Applica il ripristino in attesa, se ce n'è uno.
 *
 * Va chiamata **prima** di aprire il database e non solleva mai eccezioni: un
 * ripristino che non si può fare è un motivo per continuare con l'archivio
 * esistente, non per non partire.
 */
export function applyPendingRestore(locations: RestoreLocations, now: Date = new Date()): RestoreOutcome {
  const marker = readPendingRestore(locations.dataRoot);
  if (marker === null) {
    return { kind: 'nessuno' };
  }

  if (!marker.ok) {
    logger.error(`Ripristino non eseguito: ${marker.problem}`);
    quarantine(locations.dataRoot);

    return { kind: 'rifiutato', problem: marker.problem };
  }

  const pending = marker.pending;
  const candidate = path.join(locations.tmpDir, pending.candidateFile);

  let movedAside: string | null = null;

  try {
    if (!existsSync(candidate)) {
      return withoutCandidate(locations, pending);
    }

    const problem = verifyCandidate(locations, pending, candidate);
    if (problem !== null) {
      logger.error(`Ripristino rifiutato: ${problem}`, {
        backup: pending.backupName,
        archivioCorrente: 'invariato',
      });
      quarantine(locations.dataRoot);

      return { kind: 'rifiutato', problem };
    }

    const swapped = swap(locations, pending, candidate, now);
    movedAside = swapped.replacedFile;

    clearPendingRestore(locations.dataRoot);
    pruneReplaced(locations.tmpDir);

    logger.info('Ripristino applicato', {
      backup: pending.backupName,
      archivioPrecedente: swapped.replacedFile ?? 'nessuno',
      backupPreRestore: pending.preRestoreBackup,
    });

    return {
      kind: 'applicato',
      backupName: pending.backupName,
      replacedFile: swapped.replacedFile ?? 'nessuno',
    };
  } catch (error) {
    const problem = error instanceof Error ? error.message : 'errore sconosciuto';

    // Il caso che non deve mai lasciare l'applicazione senza archivio: se il
    // database corrente era già stato spostato via, torna al suo posto. Senza
    // questo passaggio SQLite ne creerebbe uno vuoto, e l'utente vedrebbe un
    // conto azzerato con i propri dati altrove.
    const recovered = restoreMovedAside(locations, movedAside);

    logger.error(`Ripristino interrotto da un errore: ${problem}`, {
      archivioPrecedente: recovered ? 'rimesso al suo posto' : 'non era stato spostato',
    });
    quarantine(locations.dataRoot);

    return recovered
      ? { kind: 'recuperato', problem }
      : { kind: 'rifiutato', problem };
  }
}

/** Rimette il database spostato al suo posto. `true` se è servito. */
function restoreMovedAside(locations: RestoreLocations, replacedFile: string | null): boolean {
  if (replacedFile === null || existsSync(locations.databaseFile)) {
    return false;
  }

  const source = path.join(locations.tmpDir, replacedFile);
  if (!existsSync(source)) {
    return false;
  }

  try {
    renameSync(source, locations.databaseFile);

    // Il `-wal` era stato spostato insieme al database: torna con lui, o le
    // scritture non ancora consolidate resterebbero indietro.
    if (existsSync(`${source}-wal`)) {
      renameSync(`${source}-wal`, `${locations.databaseFile}-wal`);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Cosa fare quando il database preparato non c'è.
 *
 * Con lo stato `applying` la sua assenza è un'informazione, non un guasto:
 * significa che lo scambio era arrivato al punto di commit. Con lo stato
 * `staged` significa invece che il file è stato perso prima di cominciare.
 */
function withoutCandidate(locations: RestoreLocations, pending: PendingRestore): RestoreOutcome {
  if (pending.state === 'applying') {
    if (existsSync(locations.databaseFile)) {
      clearPendingRestore(locations.dataRoot);
      logger.info('Ripristino già completato in una esecuzione precedente', {
        backup: pending.backupName,
      });

      return { kind: 'gia-applicato', backupName: pending.backupName };
    }

    // Né il candidato né il database: si torna all'archivio precedente.
    if (restoreMovedAside(locations, pending.replacedFile)) {
      const problem =
        'lo scambio dei file era stato interrotto: è stato rimesso al suo posto l\'archivio precedente.';
      logger.error(`Ripristino non completato. ${problem}`, { backup: pending.backupName });
      quarantine(locations.dataRoot);

      return { kind: 'recuperato', problem };
    }
  }

  const problem = 'il database preparato per il ripristino non è più presente.';
  logger.error(`Ripristino non eseguito: ${problem}`, { backup: pending.backupName });
  quarantine(locations.dataRoot);

  return { kind: 'rifiutato', problem };
}
