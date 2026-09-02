import { createServer, Socket, type Server } from 'node:net';

/**
 * Il canale di controllo di un'istanza in esecuzione.
 *
 * È un socket su `127.0.0.1`, una riga JSON per richiesta. Serve tre cose che
 * altrimenti richiederebbero tre meccanismi diversi:
 *
 *  1. **dire di essere vivi.** È il modo in cui un secondo avvio distingue un
 *     lock legittimo da un lock rimasto dopo un crash. Un file non lo può
 *     dire — un file esiste anche se chi l'ha scritto non c'è più — mentre un
 *     socket in ascolto è una proprietà del processo: quando il processo
 *     muore, il sistema operativo lo chiude, sempre, anche se il processo è
 *     stato terminato di forza. Non esiste un "socket stale".
 *  2. **dire su quale porta è il server**, così il secondo avvio può aprire il
 *     browser sull'istanza già attiva invece di rifiutarsi e non fare nulla.
 *  3. **ricevere la richiesta di arresto.** Su Windows non c'è un segnale da
 *     inviare a un altro processo: `process.kill` lo termina, e un processo
 *     terminato non consolida il WAL. Chiederlo su un socket è ciò che rende
 *     possibile un arresto ordinato richiesto da fuori.
 *
 * ## Perché c'è un token
 *
 * Il canale ascolta su loopback, quindi qualunque programma in esecuzione
 * sulla stessa macchina potrebbe collegarvisi. `ping` non rivela nulla che non
 * sia già nel file di lock, ma `shutdown` fermerebbe l'applicazione: richiede
 * quindi un segreto che sta nel file di lock, cioè dentro `DATA_ROOT`. Chi può
 * leggerlo può già leggere l'archivio.
 */

/** Il protocollo dichiarato nelle risposte: identifica *chi* sta rispondendo. */
export const CONTROL_PROTOCOL = 'myfinance/instance/1';

/** Oltre questa dimensione la richiesta non è una richiesta. */
const MAX_REQUEST_BYTES = 8 * 1024;

/** Quanto si attende una risposta prima di considerare il canale muto. */
const DEFAULT_TIMEOUT_MS = 3_000;

export type ControlRequest =
  | { readonly cmd: 'ping' }
  | { readonly cmd: 'shutdown'; readonly token: string };

export interface PongResponse {
  readonly ok: true;
  readonly protocol: string;
  readonly pid: number;
  readonly dataRoot: string;
  /** `null` mentre il server sta ancora partendo. */
  readonly serverPort: number | null;
}

export type ControlResponse =
  | PongResponse
  | { readonly ok: true; readonly accepted: 'shutdown' }
  | { readonly ok: false; readonly problem: string };

/** Ciò che il canale deve sapere per rispondere. */
export interface ControlHandlers {
  readonly dataRoot: string;
  /**
   * Il segreto che autorizza l'arresto, letto al momento di rispondere.
   *
   * È una funzione e non un valore per una ragione di ordine: il canale deve
   * essere in ascolto **prima** che il lock venga scritto — è il lock a
   * contenerne la porta — mentre il token nasce con il lock. Una stringa
   * costante costringerebbe a inventare un token prima di sapere se il lock
   * sarà nostro; una funzione lascia che sia il lock a deciderlo.
   *
   * Finché restituisce una stringa vuota, `shutdown` viene rifiutato: non
   * c'è ancora un'istanza da fermare.
   */
  readonly token: () => string;
  readonly serverPort: () => number | null;
  readonly shutdown: () => void;
}

export interface ControlChannel {
  readonly port: number;
  readonly close: () => Promise<void>;
}

function reply(socket: Socket, response: ControlResponse, afterFlush?: () => void): void {
  socket.end(`${JSON.stringify(response)}\n`, () => {
    afterFlush?.();
  });
}

function handle(socket: Socket, handlers: ControlHandlers): void {
  let buffer = '';

  socket.setEncoding('utf8');
  // Una connessione che non dice niente non deve restare aperta.
  socket.setTimeout(DEFAULT_TIMEOUT_MS, () => {
    socket.destroy();
  });
  socket.on('error', () => {
    socket.destroy();
  });

  socket.on('data', (chunk: string) => {
    buffer += chunk;

    if (buffer.length > MAX_REQUEST_BYTES) {
      socket.destroy();

      return;
    }

    const newline = buffer.indexOf('\n');
    if (newline < 0) {
      return;
    }

    const line = buffer.slice(0, newline);
    buffer = '';

    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      reply(socket, { ok: false, problem: 'richiesta non interpretabile' });

      return;
    }

    const cmd =
      typeof request === 'object' && request !== null && 'cmd' in request
        ? (request as { cmd: unknown }).cmd
        : undefined;

    if (cmd === 'ping') {
      reply(socket, {
        ok: true,
        protocol: CONTROL_PROTOCOL,
        pid: process.pid,
        dataRoot: handlers.dataRoot,
        serverPort: handlers.serverPort(),
      });

      return;
    }

    if (cmd === 'shutdown') {
      const atteso = handlers.token();
      const token = (request as { token?: unknown }).token;

      // Un token atteso vuoto non è un token che combacia con una richiesta
      // vuota: significa che non c'è ancora niente da fermare.
      if (atteso.length === 0 || token !== atteso) {
        reply(socket, { ok: false, problem: 'token non valido' });

        return;
      }

      // La risposta parte **prima** dell'arresto: chi l'ha chiesto deve
      // sapere che è stata accettata, e un arresto che comincia subito
      // chiuderebbe il socket prima di rispondere.
      reply(socket, { ok: true, accepted: 'shutdown' }, () => {
        setImmediate(handlers.shutdown);
      });

      return;
    }

    reply(socket, { ok: false, problem: `comando sconosciuto: ${String(cmd)}` });
  });
}

/**
 * Apre il canale su una porta assegnata dal sistema.
 *
 * Va aperto **prima** di scrivere il file di lock: chi legge quel file deve
 * trovarvi una porta già in ascolto, altrimenti due avvii simultanei
 * potrebbero considerarsi a vicenda morti.
 */
export function startControlServer(handlers: ControlHandlers): Promise<ControlChannel> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((socket) => {
      handle(socket, handlers);
    });

    server.once('error', reject);
    // Solo loopback: il canale può fermare l'applicazione, e non deve essere
    // raggiungibile dalla rete locale.
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('il canale di controllo non ha una porta'));

        return;
      }

      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}

/**
 * Interroga un canale di controllo.
 *
 * `null` significa "nessuna risposta utilizzabile": porta chiusa, silenzio,
 * o qualcosa che risponde ma non è questo protocollo. Per chi deve decidere se
 * un lock è ancora valido, i tre casi sono lo stesso caso.
 */
export function ask(
  port: number,
  request: ControlRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ControlResponse | null> {
  return new Promise((resolve) => {
    let risolto = false;
    let buffer = '';

    const finish = (response: ControlResponse | null): void => {
      if (risolto) {
        return;
      }
      risolto = true;
      socket.destroy();
      resolve(response);
    };

    const socket = new Socket();
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs, () => {
      finish(null);
    });
    socket.on('error', () => {
      finish(null);
    });
    socket.on('close', () => {
      finish(null);
    });

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        finish(null);

        return;
      }

      const newline = buffer.indexOf('\n');
      if (newline < 0) {
        return;
      }

      try {
        finish(JSON.parse(buffer.slice(0, newline)) as ControlResponse);
      } catch {
        finish(null);
      }
    });

    socket.connect(port, '127.0.0.1', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
  });
}

/**
 * L'istanza in ascolto su questa porta è MyFinance per questa radice dati?
 *
 * Le due condizioni sono entrambe necessarie. La porta di un processo morto
 * può essere stata riassegnata dal sistema a un programma qualsiasi: se
 * quello risponde qualcosa che non è questo protocollo, o dichiara un'altra
 * radice dati, il lock che lo nominava è da considerare abbandonato.
 */
export async function isLiveInstance(port: number, dataRoot: string): Promise<boolean> {
  const response = await ask(port, { cmd: 'ping' });

  return (
    response !== null &&
    response.ok &&
    'protocol' in response &&
    response.protocol === CONTROL_PROTOCOL &&
    response.dataRoot === dataRoot
  );
}
