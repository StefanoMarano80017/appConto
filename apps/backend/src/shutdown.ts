import type { Server } from 'node:http';
import { closeDatabase } from './db/client.js';
import type { DatabaseCloseOutcome } from './db/client.js';
import { logger } from './shared/logger.js';
import type { Logger } from './shared/logger.js';

/**
 * Arresto ordinato.
 *
 * Il database usa il WAL: se il processo muore senza consolidarlo, i dati
 * restano in un file separato e il database principale non è autosufficiente.
 * L'arresto controllato è quindi ciò che rende vera la promessa "copia la
 * cartella e ritrova i dati".
 *
 * La sequenza è:
 *
 *     richiesta -> attività periodiche ferme -> HTTP chiuso
 *               -> WAL consolidato -> connessione chiusa -> uscita
 *
 * Su Windows nessuno di questi passaggi avviene se il processo viene
 * terminato: `TerminateProcess` non consegna segnali. È per questo che il
 * launcher non uccide il server ma gli **chiede** di fermarsi, e attende.
 */

/** Quanto si attende che le connessioni aperte si concludano da sole. */
const GRACE_PERIOD_MS = 5_000;

/**
 * Quanto si concede all'intera procedura prima di uscire comunque.
 *
 * Un arresto che non finisce è peggio di un arresto imperfetto: il processo
 * resterebbe vivo trattenendo il lock e il file del database, e l'utente non
 * potrebbe riavviare l'applicazione. Scaduto questo tempo si registra cosa non
 * si è chiuso e si esce con un codice diverso da zero, perché il WAL potrebbe
 * non essere consolidato.
 */
const SAFETY_TIMEOUT_MS = 15_000;

/**
 * Le attività che devono fermarsi prima di chiudere il database.
 *
 * Oggi è lo scheduler dei backup automatici. `stop` deve essere idempotente e
 * sincrono: quando ritorna, non deve esistere nulla che possa ancora scrivere.
 */
export interface BackgroundWork {
  readonly stop: () => void;
}

function stopBackgroundWork(background: BackgroundWork | undefined, log: Logger): void {
  try {
    background?.stop();
  } catch (error) {
    log.error('Impossibile fermare le attività periodiche', error);
  }
}

export type CloseResult = 'consolidato' | 'non-consolidato' | 'fallito';

/**
 * Chiude il database e dice com'è andata, senza mai sollevare.
 *
 * Un errore qui non deve impedire l'uscita: il processo resterebbe vivo
 * trattenendo il lock e il file del database. Si registra e si segnala con
 * `'fallito'`, che porta a un codice di uscita diverso da zero.
 */
export function closeAndReport(
  closeDatabase: () => DatabaseCloseOutcome,
  log: Logger,
): CloseResult {
  try {
    const outcome = closeDatabase();
    if (outcome.checkpointed) {
      log.info('Database chiuso, WAL consolidato', outcome);
      return 'consolidato';
    }
    // I dati non sono a rischio — il WAL resta valido e verrà consolidato al
    // prossimo avvio — ma il database non è un file singolo, e chi copiasse
    // ora la cartella dovrebbe portarsi anche il `-wal`.
    log.error('Database chiuso senza consolidare il WAL', outcome);
    return 'non-consolidato';
  } catch (error) {
    log.error('Impossibile chiudere il database', error);
    return 'fallito';
  }
}

export interface ShutdownDeps {
  readonly server: Server;
  readonly background?: BackgroundWork;
  readonly closeDatabase: () => DatabaseCloseOutcome;
  /** Parametro per poter osservare il codice nei test senza terminare il processo. */
  readonly exit: (code: number) => void;
  readonly log: Logger;
  readonly graceMs?: number;
  readonly safetyMs?: number;
}

/**
 * Crea la procedura di arresto.
 *
 * Nell'ordine:
 *
 *  1. le attività periodiche vengono fermate — un backup automatico non deve
 *     partire mentre si sta chiudendo;
 *  2. parte il timeout di sicurezza;
 *  3. il server non accetta nuove connessioni e quelle inattive vengono chiuse;
 *  4. dopo un periodo di grazia le connessioni restanti vengono chiuse comunque;
 *  5. al completamento della chiusura HTTP, il WAL viene consolidato e la
 *     connessione chiusa;
 *  6. il processo termina con codice 0 solo se il checkpoint è riuscito.
 *
 * La funzione restituita è idempotente: una seconda richiesta durante
 * l'arresto non fa nulla. Non è una cortesia — le richieste arrivano da
 * sorgenti indipendenti (un segnale, il launcher, la chiusura della finestra)
 * e possono facilmente arrivare insieme. Lo stato appartiene all'istanza e non
 * al modulo, così due istanze (nei test) non si influenzano.
 */
export function createShutdown(deps: ShutdownDeps): (reason: string) => void {
  const { server, background, closeDatabase, exit, log } = deps;
  const graceMs = deps.graceMs ?? GRACE_PERIOD_MS;
  const safetyMs = deps.safetyMs ?? SAFETY_TIMEOUT_MS;
  let shuttingDown = false;

  return (reason: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    log.info(`Arresto richiesto (${reason})`);
    stopBackgroundWork(background, log);

    let forceClose: NodeJS.Timeout | undefined;
    let safety: NodeJS.Timeout | undefined;
    let finished = false;

    const finish = (httpError?: Error): void => {
      if (finished) {
        return;
      }
      finished = true;

      if (httpError !== undefined) {
        log.error('Impossibile chiudere il server HTTP', httpError);
      }

      const result = closeAndReport(closeDatabase, log);
      if (httpError === undefined && result === 'consolidato') {
        log.info('Arresto completato');
      }
      if (forceClose !== undefined) {
        clearTimeout(forceClose);
      }
      if (safety !== undefined) {
        clearTimeout(safety);
      }
      exit(httpError !== undefined || result !== 'consolidato' ? 1 : 0);
    };

    // Deliberatamente **non** `unref()`: la rete di sicurezza deve poter
    // scattare se una risorsa impedisce al ciclo di eventi di svuotarsi.
    safety = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;

      if (forceClose !== undefined) {
        clearTimeout(forceClose);
      }

      log.error(
        `Arresto non completato entro ${String(safetyMs / 1000)} secondi: uscita forzata. Il WAL potrebbe non essere consolidato e verrà recuperato al prossimo avvio.`,
      );
      exit(1);
    }, safetyMs);

    try {
      server.close(finish);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    server.closeIdleConnections();

    if (!finished) {
      forceClose = setTimeout(() => {
        log.info('Connessioni ancora attive: chiusura forzata');
        server.closeAllConnections();
      }, graceMs);
      forceClose.unref();
    }
  };
}

const legacyShutdowns = new WeakMap<Server, (reason: string) => void>();

/**
 * Compatibilità con l'API precedente: la procedura resta quella creata da
 * `createShutdown`, con stato idempotente legato al server. Per ogni server,
 * la prima chiamata determina `exit` e `background`; le successive richieste
 * riusano quella procedura e non possono sostituirne le dipendenze.
 */
export function shutdown(
  server: Server,
  reason: string,
  exit: (code: number) => void,
  background?: BackgroundWork,
): void {
  let request = legacyShutdowns.get(server);
  if (request === undefined) {
    request = createShutdown({
      server,
      ...(background === undefined ? {} : { background }),
      closeDatabase,
      exit,
      log: logger,
    });
    legacyShutdowns.set(server, request);
  }
  request(reason);
}

/**
 * Registra i gestori legacy per i tre segnali di shutdown originali.
 */
export function installShutdownHandlers(server: Server, background?: BackgroundWork): void {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      shutdown(
        server,
        signal,
        (code) => {
          process.exit(code);
        },
        background,
      );
    });
  }
}

export interface SignalSource {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
}

/**
 * Registra la gestione delle richieste di arresto.
 *
 * Quattro sorgenti, tutte necessarie su Windows:
 *
 *  - `SIGINT` — Ctrl+C in un terminale, ed è anche ciò che un launcher invia
 *    sulle piattaforme che consegnano segnali;
 *  - `SIGHUP` — Node lo sintetizza quando la **finestra della console viene
 *    chiusa**. È la sorgente che conta per chi usa la cartella portatile:
 *    Windows concede pochi secondi prima di terminare comunque il processo, e
 *    consolidare il WAL ne richiede una frazione;
 *  - `SIGBREAK` — Ctrl+Break su Windows, che non passa da `SIGINT`;
 *  - `SIGTERM` — non viene consegnato su Windows, ma è il segnale corretto su
 *    Linux e macOS.
 *
 * Il canale che il launcher usa davvero non è un segnale ma un messaggio IPC,
 * gestito in `launcher-ipc.ts`: è l'unico modo affidabile su Windows, dove
 * `process.kill` termina il processo invece di avvisarlo.
 */
export function installSignalHandlers(
  request: (reason: string) => void,
  proc: SignalSource = process,
): void {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
    proc.on(signal, () => {
      request(signal);
    });
  }
}
