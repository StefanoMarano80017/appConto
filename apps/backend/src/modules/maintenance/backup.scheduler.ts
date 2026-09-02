import { parseBackupName } from './backup.naming.js';
import type { BackupInfo } from './backup.service.js';

/**
 * Chi crea i backup automatici.
 *
 * WP-P3 ha scritto e provato la politica di ritenzione del tipo `auto` — sette
 * slot giornalieri unione quattro settimanali — ma nessuna parte del sistema
 * creava quei backup: la politica esisteva senza nulla da conservare. Questo
 * modulo è il pezzo mancante, e non ne aggiunge di nuovi: chiede al servizio
 * di manutenzione esattamente ciò che chiede l'endpoint HTTP, cioè un backup
 * verificato, e lascia a lui la creazione, la verifica e la ritenzione.
 *
 * ## La cadenza deriva dalla ritenzione, non è una scelta nuova
 *
 * La politica di P3 conserva **il più recente di ciascuno degli ultimi sette
 * giorni**: un secondo backup nello stesso giorno sostituirebbe il primo nello
 * stesso slot, cioè sarebbe lavoro buttato. Da qui l'intervallo predefinito di
 * ventiquattro ore: è la frequenza che la ritenzione già implicava.
 *
 * ## L'attesa non parte dall'avvio
 *
 * Un'applicazione da scrivania non è un servizio: può restare accesa dieci
 * minuti al giorno. Un timer di ventiquattro ore contato dall'avvio non
 * scatterebbe mai, e la copertura giornaliera promessa dalla ritenzione non
 * esisterebbe. La prima attesa si misura quindi dal backup automatico **più
 * recente presente su disco**: se è più vecchio dell'intervallo, se ne fa uno
 * poco dopo l'avvio; altrimenti si attende il tempo che resta.
 *
 * ## Perché non serve difendersi dalla concorrenza
 *
 * `create` è sincrona — tutto l'accesso a SQLite in questa applicazione lo è —
 * e il timer successivo viene armato **dopo** che è ritornata. Due backup
 * sovrapposti non sono improbabili: sono impossibili, e non per una guardia
 * che si potrebbe dimenticare di aggiornare, ma per la forma del ciclo.
 */

/** Cosa serve allo scheduler, e nient'altro. */
export interface SchedulerPort {
  /** Ogni quanto si vuole un backup automatico. Zero o meno: disattivato. */
  readonly intervalMs: number;
  /**
   * Quanto si attende comunque prima del primo backup.
   *
   * L'avvio è il momento peggiore per un `VACUUM INTO`: si è appena migrato,
   * si è forse appena riempito un fingerprint, e il browser sta chiedendo la
   * prima schermata. Questo margine tiene il backup fuori da quella finestra.
   */
  readonly settleMs: number;
  /** I backup presenti, come li elenca il servizio di manutenzione. */
  readonly list: () => readonly BackupInfo[];
  /** Crea il backup automatico. Può sollevare: è un esito previsto. */
  readonly create: () => BackupInfo;
  readonly now: () => Date;
  readonly onEvent: (event: SchedulerEvent) => void;
}

export type SchedulerEvent =
  | { readonly kind: 'disattivato' }
  | { readonly kind: 'programmato'; readonly delayMs: number; readonly intervalMs: number }
  | { readonly kind: 'creato'; readonly name: string; readonly bytes: number }
  | { readonly kind: 'fallito'; readonly problem: string }
  | { readonly kind: 'fermato' };

/**
 * L'istante di un backup, dal manifest se c'è, dal nome altrimenti.
 *
 * Il nome porta l'ora **locale** e il manifest l'istante UTC: il primo è
 * sempre disponibile, il secondo è più preciso. Un backup senza manifest è un
 * residuo che il ripristino rifiuterebbe, ma per decidere quando fare il
 * prossimo vale comunque come "è già stato fatto un backup allora".
 */
export function momentOf(info: BackupInfo): Date | null {
  if (info.createdAt !== null) {
    const fromManifest = new Date(info.createdAt);
    if (!Number.isNaN(fromManifest.getTime())) {
      return fromManifest;
    }
  }

  const parsed = parseBackupName(info.name);
  if (parsed === null) {
    return null;
  }

  const { day, time } = parsed;

  return new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(4, 6)) - 1,
    Number(day.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6)),
  );
}

/** Il backup automatico più recente, o `null` se non ce n'è nessuno. */
export function newestAuto(backups: readonly BackupInfo[]): Date | null {
  let newest: Date | null = null;

  for (const info of backups) {
    if (info.kind !== 'auto') {
      continue;
    }

    const moment = momentOf(info);
    if (moment !== null && (newest === null || moment.getTime() > newest.getTime())) {
      newest = moment;
    }
  }

  return newest;
}

/**
 * Fra quanto va fatto il prossimo backup automatico.
 *
 * Funzione pura: è la sola decisione che lo scheduler prende, e va potuta
 * verificare senza aspettare né creare file.
 *
 * Un backup con data nel futuro — orologio spostato indietro, archivio
 * arrivato da un'altra macchina — non deve congelare i backup per giorni: si
 * tratta come "appena fatto", cioè si attende un intervallo pieno.
 */
export function nextDelayMs(
  newest: Date | null,
  now: Date,
  intervalMs: number,
  settleMs: number,
): number {
  if (newest === null) {
    return settleMs;
  }

  const elapsed = now.getTime() - newest.getTime();
  const remaining = elapsed < 0 ? intervalMs : intervalMs - elapsed;

  return Math.max(settleMs, remaining);
}

export interface BackupScheduler {
  /** Programma il prossimo backup. Chiamarla due volte non raddoppia i timer. */
  readonly start: () => void;
  /** Ferma le attività. Idempotente, sincrona: al ritorno nulla può più scrivere. */
  readonly stop: () => void;
  /** Se c'è un backup programmato in questo momento. */
  readonly running: () => boolean;
}

/**
 * Lo scheduler.
 *
 * `setTimeout` riarmato e non `setInterval`: l'intervallo va contato dalla
 * fine di un backup, non dal suo inizio, e un `setInterval` accumulerebbe
 * scadenze se una creazione durasse più dell'intervallo.
 *
 * Il timer è `unref`: il processo non deve restare vivo perché esiste un
 * backup programmato. Ciò che tiene vivo il server è il server.
 */
export function createBackupScheduler(port: SchedulerPort): BackupScheduler {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const arm = (delayMs: number): void => {
    if (stopped) {
      return;
    }

    port.onEvent({ kind: 'programmato', delayMs, intervalMs: port.intervalMs });

    timer = setTimeout(() => {
      timer = null;
      if (stopped) {
        return;
      }

      try {
        const created = port.create();
        port.onEvent({ kind: 'creato', name: created.name, bytes: created.bytes });
      } catch (error) {
        // Un backup fallito non è un guasto dell'applicazione: il servizio non
        // lascia file a metà, e fra ventiquattro ore si riprova. Fermare lo
        // scheduler qui significherebbe non riprovare più.
        port.onEvent({
          kind: 'fallito',
          problem: error instanceof Error ? error.message : 'errore sconosciuto',
        });
      }

      arm(port.intervalMs);
    }, delayMs);

    timer.unref();
  };

  return {
    start(): void {
      if (stopped || timer !== null) {
        return;
      }

      if (!Number.isFinite(port.intervalMs) || port.intervalMs <= 0) {
        port.onEvent({ kind: 'disattivato' });

        return;
      }

      arm(nextDelayMs(newestAuto(port.list()), port.now(), port.intervalMs, port.settleMs));
    },

    stop(): void {
      if (stopped) {
        return;
      }
      stopped = true;

      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }

      port.onEvent({ kind: 'fermato' });
    },

    running(): boolean {
      return timer !== null;
    },
  };
}
