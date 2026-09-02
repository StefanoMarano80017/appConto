import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { LOGS_DIR } from '../paths.js';

/**
 * Logger minimale, con una copia persistente.
 *
 * Le operazioni di dominio non lo utilizzano: viene usato solo dai bordi
 * dell'applicazione (bootstrap, routes, error handler).
 *
 * In produzione lo stdout del processo non ha una finestra dove finire, quindi
 * ogni riga viene scritta anche in `DATA_ROOT/logs/`. Il file appartiene ai
 * dati dell'utente, non all'applicazione: sopravvive a un aggiornamento.
 *
 * **Nel file non finiscono importi né descrizioni di transazioni.** Il log
 * serve a capire perché l'applicazione non parte o non trova i dati, non a
 * ricostruire l'archivio: registra il ciclo di vita, i percorsi e gli errori
 * tecnici. Chi aggiunge una chiamata deve rispettare questo confine — i
 * dettagli di una riga di CSV scartata, per esempio, appartengono alla
 * risposta HTTP e non al disco.
 */

/** Per quanti giorni si conservano i file. */
const RETENTION_DAYS = 14;

type Level = 'info' | 'error';

/** Diventa `false` al primo errore di scrittura: un log non deve fermare l'app. */
let fileSinkEnabled = true;
let prunedOnce = false;

/** `YYYY-MM-DD` in ora locale: il nome del file segue la giornata dell'utente. */
function dayStamp(moment: Date): string {
  const year = moment.getFullYear();
  const month = String(moment.getMonth() + 1).padStart(2, '0');
  const day = String(moment.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Elimina i file più vecchi della ritenzione.
 *
 * Il nome contiene la data in forma ordinabile, quindi basta confrontare
 * stringhe: nessuna lettura di metadati, nessuna interpretazione di fusi orari.
 */
function pruneOldFiles(directory: string, today: Date): void {
  const limit = new Date(today);
  limit.setDate(limit.getDate() - RETENTION_DAYS);
  const oldest = `app-${dayStamp(limit)}.log`;

  for (const name of readdirSync(directory)) {
    if (name.startsWith('app-') && name.endsWith('.log') && name < oldest) {
      rmSync(path.join(directory, name), { force: true });
    }
  }
}

/** Il dettaglio in forma leggibile, senza far esplodere il logger. */
function formatDetails(details: unknown): string {
  if (details === undefined || details === null) {
    return '';
  }

  if (details instanceof Error) {
    return ` ${details.name}: ${details.message}${details.stack === undefined ? '' : `\n${details.stack}`}`;
  }

  try {
    return ` ${JSON.stringify(details)}`;
  } catch {
    return ' [dettaglio non serializzabile]';
  }
}

function appendToFile(level: Level, message: string, details: unknown): void {
  if (!fileSinkEnabled) {
    return;
  }

  try {
    mkdirSync(LOGS_DIR, { recursive: true });

    const now = new Date();
    if (!prunedOnce) {
      prunedOnce = true;
      pruneOldFiles(LOGS_DIR, now);
    }

    const line = `${now.toISOString()} [${level}] ${message}${formatDetails(details)}\n`;
    appendFileSync(path.join(LOGS_DIR, `app-${dayStamp(now)}.log`), line, 'utf8');
  } catch {
    // Un disco pieno o una cartella non scrivibile non devono impedire
    // all'applicazione di funzionare: resta lo stdout.
    fileSinkEnabled = false;
  }
}

export const logger = {
  info(message: string, details?: unknown): void {
    console.log(`[info] ${message}`, details ?? '');
    appendToFile('info', message, details);
  },
  error(message: string, details?: unknown): void {
    console.error(`[error] ${message}`, details ?? '');
    appendToFile('error', message, details);
  },
};
