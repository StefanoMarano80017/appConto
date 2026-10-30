import type { Server } from 'node:http';
import type { DatabaseCloseOutcome } from './db/client.js';
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
 *  2. il server non accetta nuove connessioni;
 *  3. le connessioni inattive vengono chiuse subito — il keep-alive di un
 *     browser non ha motivo di trattenere l'arresto;
 *  4. dopo un periodo di grazia le restanti vengono chiuse comunque, perché
 *     una richiesta interminabile non deve impedire il checkpoint;
 *  5. il WAL viene consolidato e la connessione chiusa;
 *  6. il processo termina.
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

    // Prima di tutto il resto: da qui in poi nessuna attività periodica deve
    // poter iniziare a scrivere.
    try {
      background?.stop();
    } catch (error) {
      log.error('Impossibile fermare le attività periodiche', error);
    }

    let forceClose: NodeJS.Timeout | undefined;
    let safety: NodeJS.Timeout | undefined;
    let finished = false;

    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;

      if (forceClose !== undefined) {
        clearTimeout(forceClose);
      }
      if (safety !== undefined) {
        clearTimeout(safety);
      }

      const result = closeAndReport(closeDatabase, log);

      if (result !== 'fallito') {
        log.info('Arresto completato');
      }
      exit(result === 'fallito' ? 1 : 0);
    };

    server.close(finish);
    server.closeIdleConnections();

    forceClose = setTimeout(() => {
      log.info('Connessioni ancora attive: chiusura forzata');
      server.closeAllConnections();
    }, graceMs);
    forceClose.unref();

    // Deliberatamente **non** `unref()`: è la rete di sicurezza, e se il ciclo
    // di eventi resta occupato da una risorsa che non si chiude deve poter
    // scattare. Se invece il ciclo si svuota, il processo esce da sé — che è
    // l'esito che questo timer cerca comunque di ottenere.
    safety = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;

      log.error(
        `Arresto non completato entro ${String(safetyMs / 1000)} secondi: uscita forzata. Il WAL potrebbe non essere consolidato e verrà recuperato al prossimo avvio.`,
      );
      exit(1);
    }, safetyMs);
  };
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
