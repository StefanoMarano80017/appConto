import path from 'node:path';

/**
 * Il nome di un backup, e la sola porta d'ingresso per trasformarlo in un percorso.
 *
 * Il nome non è un'etichetta: è l'unico dato che un client fornisce per
 * indicare quale archivio vuole. Farlo passare da qui, e solo da qui, è ciò che
 * impedisce che una richiesta esca dalla cartella dei backup — il controllo non
 * sta nel router, sta nel tipo di dato.
 *
 * La forma è deliberatamente rigida:
 *
 *     <tipo>-YYYYMMDD-HHmmss.sqlite
 *
 * Rigida perché è anche la difesa: `../../database.sqlite` non è un nome
 * malevolo da neutralizzare, è semplicemente un nome che non esiste. La data in
 * testa rende l'ordine alfabetico uguale all'ordine cronologico, quindi
 * nessuna parte del sistema ha bisogno di interpretare una data per ordinare.
 */

export const BACKUP_KINDS = ['pre-migration', 'pre-restore', 'auto', 'manual'] as const;

export type BackupKind = (typeof BACKUP_KINDS)[number];

/** L'estensione del database di backup. */
export const BACKUP_EXTENSION = '.sqlite';

/** Il suffisso di un backup non ancora verificato, che vive solo in `tmp/`. */
export const PARTIAL_SUFFIX = '.partial';

const NAME_PATTERN = /^(pre-migration|pre-restore|auto|manual)-(\d{8})-(\d{6})\.sqlite$/;

/** Le componenti di un nome valido. */
export interface ParsedBackupName {
  readonly kind: BackupKind;
  /** `YYYYMMDD`, ora locale. */
  readonly day: string;
  /** `HHmmss`, ora locale. */
  readonly time: string;
}

/** Due cifre. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Il nome di un backup creato in un dato istante.
 *
 * L'orario è quello locale, come per i file di log: il nome che l'utente vede
 * deve corrispondere all'ora del suo orologio, non a UTC. L'istante esatto e
 * non ambiguo resta nel manifest, in forma ISO.
 */
export function backupName(kind: BackupKind, moment: Date): string {
  const day = `${String(moment.getFullYear())}${pad(moment.getMonth() + 1)}${pad(moment.getDate())}`;
  const time = `${pad(moment.getHours())}${pad(moment.getMinutes())}${pad(moment.getSeconds())}`;

  return `${kind}-${day}-${time}${BACKUP_EXTENSION}`;
}

/** Le componenti del nome, oppure `null` se non è un nome di backup. */
export function parseBackupName(name: string): ParsedBackupName | null {
  const match = NAME_PATTERN.exec(name);
  if (match === null) {
    return null;
  }

  const [, kind, day, time] = match;

  // Il pattern garantisce i tre gruppi; il controllo serve solo al tipo.
  if (kind === undefined || day === undefined || time === undefined) {
    return null;
  }

  return { kind: kind as BackupKind, day, time };
}

/** Il nome del manifest che accompagna un backup. */
export function manifestNameFor(name: string): string {
  return `${name.slice(0, -BACKUP_EXTENSION.length)}.json`;
}

/** L'orario locale leggibile ricavato dal nome: `2026-09-01 14:30:12`. */
export function localTimestampOf(parsed: ParsedBackupName): string {
  const { day, time } = parsed;

  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)} ${time.slice(0, 2)}:${time.slice(
    2,
    4,
  )}:${time.slice(4, 6)}`;
}

/**
 * Il percorso di un backup all'interno della sua cartella, oppure `null`.
 *
 * Due sbarramenti indipendenti, perché uno solo è una svista di distanza:
 *
 *  1. il nome deve essere un nome di backup — un percorso, assoluto o
 *     relativo, non lo è;
 *  2. il percorso risolto deve trovarsi realmente sotto la cartella
 *     consentita, verificato dopo `path.resolve` e non per concatenazione.
 *
 * Il secondo controllo è ridondante rispetto al primo, ed è voluto: se un
 * giorno il pattern venisse allargato, l'invariante resterebbe.
 */
export function resolveBackupFile(backupsDir: string, name: string): string | null {
  if (parseBackupName(name) === null) {
    return null;
  }

  const root = path.resolve(backupsDir);
  const resolved = path.resolve(root, name);

  return resolved.startsWith(root + path.sep) && path.dirname(resolved) === root ? resolved : null;
}
