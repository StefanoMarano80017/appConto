import type { Server } from 'node:http';
import { closeDatabase } from './db/client.js';
import { logger } from './shared/logger.js';

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

let shuttingDown = false;

/**
 * Le attività che devono fermarsi prima di chiudere il database.
 *
 * Oggi è lo scheduler dei backup automatici. `stop` deve essere idempotente e
 * sincrono: quando ritorna, non deve esistere nulla che possa ancora scrivere.
 */
export interface BackgroundWork {
  readonly stop: () => void;
}

/**
 * Interrompe il servizio e chiude il database.
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
 * È idempotente: una seconda richiesta durante l'arresto non fa nulla. Non è
 * una cortesia — le richieste arrivano da sorgenti indipendenti (un segnale,
 * il launcher, la chiusura della finestra) e possono facilmente arrivare
 * insieme.
 *
 * `exit` è un parametro per poter osservare il codice di uscita nei test senza
 * terminare il processo che li esegue.
 */
export function shutdown(
  server: Server,
  reason: string,
  exit: (code: number) => void,
  background?: BackgroundWork,
): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  logger.info(`Arresto richiesto (${reason})`);

  // Prima di tutto il resto: da qui in poi nessuna attività periodica deve
  // poter iniziare a scrivere.
  try {
    background?.stop();
  } catch (error) {
    logger.error('Impossibile fermare le attività periodiche', error);
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

    const outcome = closeDatabase();
    if (outcome.checkpointed) {
      logger.info('Database chiuso, WAL consolidato', outcome);
    } else {
      // I dati non sono a rischio — il WAL resta valido e verrà consolidato al
      // prossimo avvio — ma il database non è un file singolo, e chi copiasse
      // ora la cartella dovrebbe portarsi anche il `-wal`.
      logger.error('Database chiuso senza consolidare il WAL', outcome);
    }

    logger.info('Arresto completato');
    exit(0);
  };

  server.close(finish);
  server.closeIdleConnections();

  forceClose = setTimeout(() => {
    logger.info('Connessioni ancora attive: chiusura forzata');
    server.closeAllConnections();
  }, GRACE_PERIOD_MS);
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

    logger.error(
      `Arresto non completato entro ${String(SAFETY_TIMEOUT_MS / 1000)} secondi: uscita forzata. Il WAL potrebbe non essere consolidato e verrà recuperato al prossimo avvio.`,
    );
    exit(1);
  }, SAFETY_TIMEOUT_MS);
}

/**
 * Registra la gestione delle richieste di arresto.
 *
 * Tre sorgenti, tutte necessarie su Windows:
 *
 *  - `SIGINT` — Ctrl+C in un terminale, ed è anche ciò che un launcher invia
 *    sulle piattaforme che consegnano segnali;
 *  - `SIGHUP` — Node lo sintetizza quando la **finestra della console viene
 *    chiusa**. È la sorgente che conta per chi usa la cartella portatile:
 *    Windows concede pochi secondi prima di terminare comunque il processo, e
 *    consolidare il WAL ne richiede una frazione;
 *  - `SIGTERM` — non viene consegnato su Windows, ma è il segnale corretto su
 *    Linux e macOS.
 *
 * Il canale che il launcher usa davvero non è un segnale ma un messaggio IPC,
 * gestito in `main.ts`: è l'unico modo affidabile su Windows, dove
 * `process.kill` termina il processo invece di avvisarlo.
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
