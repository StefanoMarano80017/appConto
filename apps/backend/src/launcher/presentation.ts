import { ErroreUtente } from './run.js';

/**
 * Cosa vede chi ha fatto doppio clic.
 *
 * Sta in un modulo a sé e non nel punto d'ingresso perché il punto d'ingresso
 * *avvia l'applicazione* nel momento in cui viene importato: queste sono
 * decisioni su come si parla all'utente, e vanno potute verificare senza
 * avviare niente.
 */

/** I codici di uscita, che `start.bat` propaga a chi lo ha invocato. */
export const EXIT = {
  ok: 0,
  /** Un guasto tecnico: il dettaglio sta nel log. */
  tecnico: 1,
  /** Qualcosa che l'utente può capire e correggere. */
  utente: 2,
} as const;

export interface Presentazione {
  readonly testo: string;
  readonly code: number;
}

/**
 * Il messaggio di un avvio non riuscito.
 *
 * Due categorie, perché richiedono due reazioni diverse. Un archivio già in
 * uso o una copia incompleta sono situazioni che chi usa l'applicazione può
 * riconoscere e sistemare: il messaggio dice quella cosa e basta. Un guasto
 * tecnico non è azionabile, e allora la risposta utile non è la traccia di
 * stack — è dire dov'è scritta.
 */
export function presentaErrore(error: unknown, logsDir: string): Presentazione {
  if (error instanceof ErroreUtente) {
    return {
      testo: ['Impossibile avviare MyFinance.', '', error.message].join('\n'),
      code: EXIT.utente,
    };
  }

  const dettaglio = error instanceof Error ? error.message : String(error);

  return {
    testo: [
      'Impossibile avviare MyFinance.',
      '',
      'Dettaglio:',
      `  ${dettaglio}`,
      '',
      'Il registro completo è in:',
      `  ${logsDir}`,
      '',
      'I tuoi dati non sono stati modificati.',
    ].join('\n'),
    code: EXIT.tecnico,
  };
}

/**
 * Se questa finestra sparirà portandosi via il messaggio.
 *
 * `start.bat` accerta la condizione e la comunica: `%cmdcmdline%` contiene il
 * nome dello script solo quando `cmd` è stato avviato **per eseguirlo**, che è
 * ciò che accade con il doppio clic da Explorer. Da un terminale la variabile
 * contiene soltanto `cmd.exe`.
 *
 * La seconda condizione è indipendente e serve a non far attendere nessuno per
 * sbaglio: se lo standard input non è una console, dall'altra parte non c'è
 * una persona che possa premere un tasto — è uno script, e resterebbe appeso.
 * È la ragione per cui non esiste un `pause` incondizionato: il launcher deve
 * restare usabile da un terminale e da un altro programma.
 */
export function finestraTemporanea(
  env: Record<string, string | undefined>,
  stdinIsTty: boolean,
): boolean {
  return env.MYFINANCE_CONSOLE_TEMPORANEA === '1' && stdinIsTty;
}
