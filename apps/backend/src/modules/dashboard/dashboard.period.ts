/** Regole del mese mostrato nel riepilogo e della finestra di confronto: funzioni pure su stringhe. */

/** Il mese precedente a `YYYY-MM`. */
export function previousMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];

  return monthNumber === 1
    ? `${year - 1}-12`
    : `${year}-${String(monthNumber - 1).padStart(2, '0')}`;
}

/** Quanti giorni ha il mese `YYYY-MM`. */
function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];

  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

/** Primo e ultimo giorno (inclusi, `YYYY-MM-DD`) del mese `YYYY-MM`. */
export function monthBounds(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` };
}

/** Riporta un mese futuro al mese di `today`; gli altri restano invariati. */
export function clampMonth(month: string, today: string): string {
  const currentMonth = today.slice(0, 7);

  return month > currentMonth ? currentMonth : month;
}

/** Il mese da mostrare senza scelta esplicita: quello dell'ultimo movimento, mai oltre oggi. */
export function defaultMonth(lastTransactionDate: string | null, today: string): string {
  return clampMonth((lastTransactionDate ?? today).slice(0, 7), today);
}

/** Intervallo del mese precedente da confrontare con il mese mostrato (date incluse). */
export interface ComparisonWindow {
  previousFrom: string;
  previousTo: string;
  /** Ultimo giorno del mese mostrato da considerare; `null` per un mese chiuso (mese intero). */
  currentTo: string | null;
  /** Vero se il mese mostrato è quello in corso e il confronto è a parità di giorni. */
  partial: boolean;
}

export function comparisonWindow(month: string, today: string): ComparisonWindow {
  const previous = previousMonth(month);
  const previousFrom = `${previous}-01`;

  if (month !== today.slice(0, 7)) {
    return { previousFrom, previousTo: monthBounds(previous).to, currentTo: null, partial: false };
  }

  // Stesso giorno del mese precedente, troncato al suo ultimo giorno (es. 31 marzo -> 28 febbraio).
  const day = Math.min(Number(today.slice(8, 10)), daysInMonth(previous));

  return {
    previousFrom,
    previousTo: `${previous}-${String(day).padStart(2, '0')}`,
    currentTo: today,
    partial: true,
  };
}
