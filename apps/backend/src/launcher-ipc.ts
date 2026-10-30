import type { ListenOutcome } from './listen.js';

/**
 * Il canale con il launcher.
 *
 * Esiste solo se questo processo è stato avviato con un canale IPC. Serve a
 * due cose che su Windows non si possono ottenere altrimenti:
 *
 *  - **dire quale porta si è aperta**, perché è questo processo a saperlo e il
 *    launcher deve aprirvi il browser;
 *  - **ricevere la richiesta di arresto**, perché `process.kill` su Windows
 *    termina il processo invece di avvisarlo, e un processo terminato non
 *    consolida il WAL.
 *
 * Il modulo non importa nulla a runtime e vede il processo solo attraverso
 * `LauncherProcess`: nei test basta un `EventEmitter`, senza lanciare un
 * processo figlio.
 */

/** La parte di `process` che serve qui; il `process` reale vi è assegnabile senza cast. */
export interface LauncherProcess {
  readonly pid: number;
  /** `false` quando il launcher ha già chiuso il canale. */
  readonly connected?: boolean | undefined;
  /** Assente se il processo non è stato avviato con un canale IPC. */
  readonly send?:
    ((message: unknown, callback: (error: Error | null) => void) => boolean) | undefined;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'disconnect', listener: () => void): unknown;
}

/** Il messaggio con cui il launcher chiede l'arresto; ogni altro campo è ignorato. */
export function isShutdownMessage(message: unknown): message is { readonly type: 'shutdown' } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'shutdown'
  );
}

/**
 * Annuncia la porta al launcher e ne ascolta le richieste.
 *
 * Restituisce `false`, senza registrare nulla, se non c'è un canale IPC.
 * Non solleva mai: un canale che si rompe è una ragione per arrestarsi, non
 * un errore da propagare. Le richieste duplicate sono inoltrate così come
 * arrivano; renderle idempotenti spetta a chi arresta davvero.
 */
export function connectLauncher(
  proc: LauncherProcess,
  listening: ListenOutcome,
  requestShutdown: (reason: string) => void,
): boolean {
  const send = proc.send;
  if (typeof send !== 'function') return false;

  // I gestori si registrano prima di inviare `ready`: una risposta, o una
  // chiusura del canale, non deve poter arrivare quando nessuno ascolta.
  proc.on('message', (message) => {
    if (isShutdownMessage(message)) requestShutdown('launcher');
  });
  // Senza launcher nessuno aprirà il browser né chiederà l'arresto: un
  // server rimasto acceso da solo non serve a nessuno.
  proc.on('disconnect', () => {
    requestShutdown('launcher disconnesso');
  });

  if (proc.connected === false) {
    requestShutdown('launcher disconnesso');
    return true;
  }

  try {
    send.call(
      proc,
      {
        type: 'ready',
        host: listening.host,
        port: listening.actualPort,
        configuredPort: listening.configuredPort,
        pid: proc.pid,
      },
      (error) => {
        if (error !== null) requestShutdown('launcher disconnesso');
      },
    );
  } catch {
    requestShutdown('launcher disconnesso');
  }
  return true;
}
