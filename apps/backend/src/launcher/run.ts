import { spawn, type ChildProcess } from 'node:child_process';
import { localUrl } from './browser.js';
import { startControlServer } from './control.js';
import { acquireInstanceLock, type LockContent } from './instance-lock.js';
import { missingPrerequisites, type PackageLayout } from './prerequisites.js';
import { httpHealthProbe, waitUntilReady } from './readiness.js';

/**
 * Il ciclo di vita dell'applicazione.
 *
 *     prerequisiti -> canale di controllo -> istanza unica -> porta
 *                  -> processo server -> pronto -> browser
 *                  -> in esecuzione
 *                  -> arresto ordinato -> lock rilasciato
 *
 * Il launcher è un processo separato dal server, e non per simmetria: il
 * server deve continuare a essere avviabile da solo — `npm start`, i test, uno
 * smoke test — e nessun modulo applicativo deve sapere che esiste un
 * launcher. Ciò che il launcher fa, il server non saprebbe fare su sé stesso:
 * sopravvivere al proprio avvio fallito per raccontarlo, e chiedere un arresto
 * ordinato su una piattaforma che non consegna segnali.
 *
 * Tutte le dipendenze arrivano da fuori. Non è astrazione fine a sé stessa: un
 * launcher che avvia il vero server, apre un vero browser e attende un vero
 * arresto è verificabile solo a mano, e queste sono esattamente le condizioni
 * — crash all'avvio, seconda istanza, porta occupata, arresto non risposto —
 * che non si possono provocare a comando su una macchina reale.
 */

/** Un problema che l'utente può capire e, di solito, risolvere. */
export class ErroreUtente extends Error {}

/** Ciò che il launcher riceve dal proprio punto d'ingresso. */
export interface LauncherOptions extends PackageLayout {
  readonly appRoot: string;
  readonly dataRoot: string;
  readonly lockFile: string;
  readonly logsDir: string;
  readonly host: string;
  readonly configuredPort: number;
  /** Il runtime con cui avviare il server: il `node.exe` incluso, sempre. */
  readonly nodeExe: string;
  /** Il programma da avviare. Iniettabile: i test non hanno un bundle. */
  readonly serverEntry: string;
  readonly env: Record<string, string | undefined>;
  readonly openBrowser: ((url: string) => void) | null;
  readonly log: (message: string, details?: unknown) => void;
  readonly logError: (message: string, details?: unknown) => void;
  /** Entro quanto il server deve rispondere di essere in salute. */
  readonly readyTimeoutMs: number;
  /** Entro quanto deve essersi arrestato dopo che gliel'abbiamo chiesto. */
  readonly shutdownTimeoutMs: number;
}

export type LauncherOutcome =
  /** L'applicazione è stata avviata, usata, e si è fermata. */
  | { readonly kind: 'concluso'; readonly exitCode: number }
  /** Era già in esecuzione: il browser è stato aperto su quella. */
  | { readonly kind: 'gia-in-esecuzione'; readonly running: LockContent }
  /** Il server non è mai diventato pronto. */
  | { readonly kind: 'avvio-fallito'; readonly exitCode: number; readonly detail: string };

/** Quante righe dell'output del server si conservano per il messaggio d'errore. */
const TAIL_LINES = 25;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Il messaggio che il server ha inviato quando è pronto. */
interface ReadyMessage {
  readonly type: 'ready';
  readonly host: string;
  readonly port: number;
  readonly configuredPort: number;
  readonly pid: number;
}

function isReady(message: unknown): message is ReadyMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'ready' &&
    typeof (message as { port?: unknown }).port === 'number'
  );
}

export async function run(options: LauncherOptions): Promise<LauncherOutcome> {
  options.log('Launcher', {
    appRoot: options.appRoot,
    dataRoot: options.dataRoot,
    configuredPort: options.configuredPort,
    runtime: options.nodeExe,
    server: options.serverEntry,
  });

  // ─── 1. Prerequisiti ───────────────────────────────────────────────────────

  const mancanti = missingPrerequisites(options);
  if (mancanti.length > 0) {
    throw new ErroreUtente(
      [
        'La copia di MyFinance non è completa.',
        '',
        ...mancanti.map((pezzo) => `Manca ${pezzo.what}:\n  ${pezzo.file}`),
        '',
        'Ricopia la cartella dell-applicazione per intero. I tuoi dati non sono in questa cartella e non vengono toccati.',
      ].join('\n'),
    );
  }

  // ─── 2. Canale di controllo, prima del lock ────────────────────────────────

  /*
   * Il canale si apre **prima** di scrivere il lock, perché il lock ne
   * contiene la porta e chi lo legge si aspetta di trovarvi qualcuno che
   * risponde. All'ordine inverso, due avvii simultanei potrebbero leggere il
   * lock dell'altro un istante prima che il suo canale sia in ascolto e
   * concludere entrambi che l'altro è morto.
   */
  let serverPort: number | null = null;
  let token = '';
  let richiediArresto: (reason: string) => void = () => {
    // Sostituita quando c'è un server da fermare. Prima di allora una
    // richiesta di arresto non ha nulla da fermare.
  };

  const canale = await startControlServer({
    dataRoot: options.dataRoot,
    // Vuoto fino all'acquisizione del lock: è il lock a generare il token.
    token: () => token,
    serverPort: () => serverPort,
    shutdown: () => {
      richiediArresto('canale di controllo');
    },
  });

  // ─── 3. Istanza unica ──────────────────────────────────────────────────────

  const esito = await acquireInstanceLock({
    lockFile: options.lockFile,
    dataRoot: options.dataRoot,
    appRoot: options.appRoot,
    controlPort: canale.port,
    now: () => new Date(),
  });

  if (!esito.acquired) {
    await canale.close();
    const running = esito.running;

    options.log("MyFinance è già in esecuzione per questo archivio", {
      pid: running.pid,
      dallaData: running.startedAt,
      serverPort: running.serverPort,
    });

    // Non un errore: l'utente vuole vedere l'applicazione, e l'applicazione
    // c'è. Gli si apre quella, invece di dirgli di no.
    if (running.serverPort !== null && options.openBrowser !== null) {
      options.openBrowser(localUrl(options.host, running.serverPort));
    }

    return { kind: 'gia-in-esecuzione', running };
  }

  const lock = esito.lock;
  // Il token nasce con il lock, e da questo istante il canale lo pretende per
  // accettare un arresto. Una copia sola, letta dove serve.
  token = lock.content.token;

  options.log('Istanza unica acquisita', {
    lock: options.lockFile,
    controlPort: canale.port,
    token: 'registrato nel file di lock',
  });

  // ─── 4. Il processo del server ─────────────────────────────────────────────

  let child: ChildProcess | null = null;
  const coda: string[] = [];
  const registra = (testo: string): void => {
    for (const riga of testo.split(/\r?\n/)) {
      if (riga.trim().length > 0) {
        coda.push(riga);
        if (coda.length > TAIL_LINES) {
          coda.shift();
        }
      }
    }
  };

  const segnaliRegistrati: { nome: NodeJS.Signals; gestore: () => void }[] = [];

  /**
   * Il rilascio, e perché è una funzione sola.
   *
   * Il lock rilasciato, il canale chiuso e i gestori dei segnali smontati sono
   * tre cose che devono avvenire **insieme**, su ogni uscita: normale, per
   * avvio fallito, per eccezione. Tre elenchi separati divergerebbero al primo
   * ramo aggiunto — e un lock non rilasciato impedisce all'utente di riavviare
   * l'applicazione.
   */
  const chiudi = async (): Promise<void> => {
    lock.release();
    await canale.close();
    for (const segnale of segnaliRegistrati) {
      process.removeListener(segnale.nome, segnale.gestore);
    }
  };

  try {
    child = spawn(options.nodeExe, [options.serverEntry], {
      // La directory di lavoro non partecipa a nessuna risoluzione — né
      // dell'applicazione né dei dati — ma va scelta comunque: quella del
      // launcher è la scelta che non introduce un percorso nuovo.
      cwd: options.appRoot,
      env: {
        ...options.env,
        /*
         * I due lati del contratto con il server.
         *
         * La radice dati viene passata **esplicitamente** e non lasciata
         * dedurre: il lock è stato preso su questa cartella, e il server deve
         * aprire quella. Ricalcolarla sarebbe la stessa deduzione fatta due
         * volte, e due deduzioni possono divergere — basta un
         * `settings.json` riscritto nel frattempo.
         */
        MYFINANCE_DATA: options.dataRoot,
        MYFINANCE_PORT: String(options.configuredPort),
        // Il permesso di ripiegare su un'altra porta: c'è un browser da
        // aprire, e va aperto dove il server è davvero.
        MYFINANCE_PORT_FALLBACK: '1',
      },
      // `ipc` è il canale su cui il server dice quale porta ha aperto e su cui
      // gli si chiede di fermarsi. È l'unico meccanismo affidabile su Windows.
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    for (const flusso of [child.stdout, child.stderr]) {
      flusso?.setEncoding('utf8');
      flusso?.on('data', (blocco: string) => {
        registra(blocco);
        // L'output del server è l'output dell'applicazione: chi ha aperto la
        // finestra deve vederlo, non doverlo cercare in un file.
        process.stdout.write(blocco);
      });
    }

    const pid = child.pid;
    options.log('Server avviato', { pid });

    // Il messaggio di pronto porta la porta effettiva. Si attende quello, o la
    // morte del processo — qualunque arrivi prima.
    const annuncio = new Promise<ReadyMessage | null>((resolve) => {
      child?.on('message', (message: unknown) => {
        if (isReady(message)) {
          resolve(message);
        }
      });
      child?.once('exit', () => {
        resolve(null);
      });
    });

    const uscita = new Promise<number>((resolve) => {
      child?.once('exit', (code, signal) => {
        resolve(code ?? (signal === null ? 1 : 0));
      });
    });

    const arresto = { richiesto: false };
    richiediArresto = (reason: string): void => {
      if (arresto.richiesto || child === null) {
        return;
      }
      arresto.richiesto = true;

      options.log(`Arresto richiesto (${reason})`);

      try {
        /*
         * Si **chiede**, non si uccide.
         *
         * Terminare il processo lascerebbe il WAL non consolidato: il database
         * resterebbe valido — verrebbe recuperato al riavvio — ma in quel
         * momento non sarebbe un file singolo, e la promessa "copia la
         * cartella e ritrova i dati" non varrebbe.
         */
        child.send({ type: 'shutdown' });
      } catch {
        // Canale già chiuso: il processo sta uscendo da sé.
      }

      // Ultima risorsa, se non si ferma. Registrata come errore, perché
      // significa che il consolidamento del WAL non è avvenuto.
      const scadenza = setTimeout(() => {
        if (child !== null && child.exitCode === null) {
          options.logError(
            `Il server non si è arrestato entro ${String(options.shutdownTimeoutMs / 1000)} secondi: terminazione forzata. Il WAL verrà consolidato al prossimo avvio.`,
          );
          child.kill();
        }
      }, options.shutdownTimeoutMs);
      scadenza.unref();
    };

    for (const nome of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
      const gestore = (): void => {
        richiediArresto(nome);
      };
      // `SIGHUP` è ciò che Node sintetizza quando la **finestra della console
      // viene chiusa**: è la sorgente che conta per chi usa la cartella
      // portatile, e senza di essa chiudere la finestra sarebbe una
      // terminazione brusca.
      process.on(nome, gestore);
      segnaliRegistrati.push({ nome, gestore });
    }

    const pronto = await annuncio;
    if (pronto === null) {
      const code = await uscita;

      await chiudi();

      return {
        kind: 'avvio-fallito',
        exitCode: code === 0 ? 1 : code,
        detail: coda.join('\n'),
      };
    }

    if (pronto.configuredPort !== pronto.port) {
      options.log(
        `La porta ${String(pronto.configuredPort)} era occupata: l'applicazione usa la ${String(pronto.port)}`,
        { configuredPort: pronto.configuredPort, actualPort: pronto.port },
      );
    }

    // ─── 5. Pronto, e solo allora il browser ─────────────────────────────────

    const url = localUrl(pronto.host, pronto.port);
    const salute = await waitUntilReady({
      probe: () => httpHealthProbe(`${url}api/health`),
      alive: () => child !== null && child.exitCode === null,
      now: () => Date.now(),
      wait: sleep,
      timeoutMs: options.readyTimeoutMs,
      intervalMs: 200,
    });

    if (salute.kind !== 'pronto') {
      richiediArresto('server non pronto');
      const code = await uscita;
      await chiudi();

      return {
        kind: 'avvio-fallito',
        exitCode: code === 0 ? 1 : code,
        detail:
          salute.kind === 'terminato'
            ? `Il server è terminato durante l'avvio.\n${coda.join('\n')}`
            : `Il server non ha risposto entro ${String(options.readyTimeoutMs / 1000)} secondi.\n${coda.join('\n')}`,
      };
    }

    serverPort = pronto.port;
    // Da adesso un secondo avvio sa dove mandare il browser.
    lock.recordServerPort(pronto.port);

    options.log('Server pronto', {
      url,
      tentativi: salute.attempts,
      msDallAvvio: salute.elapsedMs,
    });

    if (options.openBrowser !== null) {
      options.openBrowser(url);
      options.log('Browser aperto', { url });
    } else {
      options.log('Apertura del browser non richiesta', { url });
    }

    // ─── 6. In esecuzione, fino all'arresto ──────────────────────────────────

    const code = await uscita;
    options.log('Server terminato', { exitCode: code });

    await chiudi();

    return { kind: 'concluso', exitCode: code };
  } catch (error) {
    if (child !== null && child.exitCode === null) {
      child.kill();
    }
    await chiudi();

    throw error;
  }
}
