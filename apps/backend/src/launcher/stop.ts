import { ask, type ControlRequest, type ControlResponse } from './control.js';
import { readInstanceLock } from './instance-lock.js';

/**
 * Fermare l'applicazione dall'esterno.
 *
 * Serve perché su Windows non esiste un modo corretto di chiedere a un altro
 * processo di fermarsi: `taskkill` lo termina, e un processo terminato non
 * consolida il WAL. Chiudere la finestra funziona — Node sintetizza un
 * `SIGHUP` — ma non è disponibile a uno script, e non lo è a chi ha avviato
 * l'applicazione da un collegamento.
 *
 * Il percorso è quello che userebbe una seconda istanza per scoprire la prima:
 * si legge il lock dentro `DATA_ROOT`, si trova la porta di controllo e il
 * token, e si chiede l'arresto. Non c'è un secondo meccanismo da mantenere.
 */

export type StopOutcome =
  | { readonly kind: 'nessuna-istanza' }
  | { readonly kind: 'non-risponde'; readonly pid: number }
  | { readonly kind: 'rifiutata'; readonly problem: string }
  | { readonly kind: 'arrestata'; readonly pid: number };

export interface StopRequest {
  readonly lockFile: string;
  /** Iniettabile: i test devono poter descrivere un'istanza che non risponde. */
  readonly ask?: (port: number, request: ControlRequest) => Promise<ControlResponse | null>;
}

export async function arrestaIstanza(request: StopRequest): Promise<StopOutcome> {
  const domanda = request.ask ?? ask;
  const lock = readInstanceLock(request.lockFile);

  if (lock === null) {
    // Nessun lock, o illeggibile: in entrambi i casi non c'è un'istanza da
    // fermare, ed è lo stato che chi chiama voleva ottenere.
    return { kind: 'nessuna-istanza' };
  }

  const risposta = await domanda(lock.controlPort, { cmd: 'shutdown', token: lock.token });

  if (risposta === null) {
    // Il lock c'è ma nessuno risponde: è il residuo di un processo terminato
    // di forza. Non va rimosso da qui — lo farà il prossimo avvio, che è
    // l'unico a poter stabilire con `wx` di esserne il nuovo proprietario.
    return { kind: 'non-risponde', pid: lock.pid };
  }

  if (!risposta.ok) {
    return { kind: 'rifiutata', problem: risposta.problem };
  }

  return { kind: 'arrestata', pid: lock.pid };
}

/** Il messaggio da mostrare, e il codice di uscita. */
export function presentaArresto(outcome: StopOutcome): { testo: string; code: number } {
  switch (outcome.kind) {
    case 'nessuna-istanza':
      return { testo: 'MyFinance non è in esecuzione per questo archivio.', code: 0 };

    case 'arrestata':
      return { testo: 'Arresto richiesto: MyFinance si sta chiudendo.', code: 0 };

    case 'non-risponde':
      return {
        testo: [
          `MyFinance non è in esecuzione, ma è rimasto il segno di un avvio precedente (processo ${String(outcome.pid)}).`,
          'Non c-è nulla da fare: il prossimo avvio se ne accorgerà e proseguirà.',
        ].join('\n'),
        code: 0,
      };

    case 'rifiutata':
      return {
        testo: `L-istanza in esecuzione ha rifiutato la richiesta di arresto: ${outcome.problem}`,
        code: 1,
      };
  }
}
