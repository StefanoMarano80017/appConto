import { createServer, type RequestListener, type Server } from 'node:http';
import { ListenFailedError, type ListenOutcome, type ListenRequest } from './listen.js';
import type { Logger } from './shared/logger.js';
import type { BackgroundWork } from './shutdown.js';

/**
 * L'avvio del server, senza sapere da dove arrivano database, logger e
 * applicazione: li riceve da fuori, ed è per questo che l'ordine delle fasi e
 * i messaggi si possono verificare con dipendenze finte.
 */

export interface StartOptions {
  readonly host: string;
  readonly port: number;
  readonly allowFallback: boolean;
}

export interface ServerDeps {
  readonly bootstrap: () => void;
  readonly createApp: () => RequestListener;
  readonly listen: (server: Server, request: ListenRequest) => Promise<ListenOutcome>;
  readonly createScheduler: () => { start(): void; stop(): void };
  readonly log: Logger;
}

export interface StartedServer {
  readonly server: Server;
  readonly listen: ListenOutcome;
  readonly background: BackgroundWork;
}

export type StartupPhase = 'bootstrap' | 'listen' | 'scheduler';

/** Dice in quale fase l'avvio è fallito, perché da essa dipende cosa chiudere. */
export class StartupFailedError extends Error {
  constructor(
    message: string,
    readonly phase: StartupPhase,
    cause: unknown,
  ) {
    super(message, { cause });
    this.name = 'StartupFailedError';
  }
}

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.closeAllConnections();
    server.close(() => {
      resolve();
    });
  });

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'errore sconosciuto';

/**
 * Porta il server da "niente" a "in ascolto, con i lavori di sfondo avviati".
 *
 * L'ordine è questo, e ciascun passo dipende dal precedente:
 *
 *  1. `bootstrap` — prima di tutto, perché un archivio che non si può aprire o
 *     migrare non deve mai servire richieste. Se fallisce non esiste ancora
 *     alcun server.
 *  2. creazione del server con l'applicazione.
 *  3. `listen` — la porta si occupa solo ora, a dati pronti.
 *  4. lo scheduler dei backup parte per ultimo: è l'unica cosa che lavora da
 *     sola, e non deve girare su un processo che poi non riesce ad aprire la
 *     porta.
 *
 * I gestori di arresto **non** si installano qui: sono integrazione con il
 * processo (segnali, canale IPC) e stanno in `main.ts`. Non si apre alcuna
 * finestra: fra la risoluzione del listen e il ritorno di questa funzione non
 * c'è un turno del ciclo di eventi, quindi un segnale non può arrivare in mezzo.
 *
 * Ogni fallimento è registrato qui, vicino alla fase che lo ha causato, e
 * riportato come `StartupFailedError`: a chi chiama resta solo da decidere
 * cosa chiudere e con quale codice uscire.
 */
export async function startServer(options: StartOptions, deps: ServerDeps): Promise<StartedServer> {
  const { log } = deps;

  try {
    deps.bootstrap();
  } catch (error) {
    // Un avvio che non è sicuro non diventa sicuro proseguendo. Il messaggio è
    // scritto per essere letto da chi usa l'applicazione, non da chi la scrive:
    // dice cosa non si può fare e che l'archivio non è stato modificato.
    log.error(`Avvio interrotto: ${messageOf(error)}`);
    throw new StartupFailedError(`Avvio interrotto: ${messageOf(error)}`, 'bootstrap', error);
  }

  const server = createServer(deps.createApp());

  let esito: ListenOutcome;
  try {
    esito = await deps.listen(server, {
      host: options.host,
      port: options.port,
      allowFallback: options.allowFallback,
    });
  } catch (error) {
    /*
     * Una porta occupata non è un guasto: è una macchina su cui gira già
     * qualcosa.
     *
     * Senza questo messaggio l'errore uscirebbe come traccia di stack, che su
     * una cartella portatile — dove non c'è un terminale a cui rivolgersi — non
     * dice nulla a chi la sta usando. Quando è il launcher ad avviare, questo
     * ramo non si percorre: lì il ripiego è concesso e la porta si trova.
     */
    if (error instanceof ListenFailedError && error.code === 'EADDRINUSE') {
      log.error(
        `La porta ${String(error.port)} è già occupata da un altro programma. Indica una porta diversa con la variabile MYFINANCE_PORT, oppure scrivila in config/settings.json come {"port": 47318}.`,
      );
    } else {
      log.error(
        `Impossibile mettersi in ascolto su ${options.host}:${String(options.port)}`,
        error,
      );
    }

    throw new StartupFailedError('Impossibile mettersi in ascolto', 'listen', error);
  }

  if (esito.fellBack) {
    log.info(
      `La porta ${String(esito.configuredPort)} era occupata: il server usa la ${String(esito.actualPort)}`,
      { configuredPort: esito.configuredPort, actualPort: esito.actualPort },
    );
  }

  log.info(`Backend in ascolto su http://${esito.host}:${String(esito.actualPort)}`, {
    configuredPort: esito.configuredPort,
    actualPort: esito.actualPort,
  });

  const scheduler = deps.createScheduler();
  try {
    scheduler.start();
  } catch (error) {
    // Il server è già in ascolto: lasciarlo aperto farebbe credere a chi lo
    // usa che l'applicazione sia avviata, mentre i backup automatici no.
    try {
      scheduler.stop();
    } catch {
      // Best effort: un avvio parziale dello scheduler non deve nascondere la causa.
    }
    await closeServer(server);
    log.error('Impossibile avviare i backup automatici', error);

    throw new StartupFailedError('Impossibile avviare i backup automatici', 'scheduler', error);
  }

  return { server, listen: esito, background: scheduler };
}
