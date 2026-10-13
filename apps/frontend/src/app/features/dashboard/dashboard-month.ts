import { ComparisonWindow } from './dashboard.model';

/*
 * Regole del mese nel riepilogo: funzioni pure su stringhe `YYYY-MM` e
 * `YYYY-MM-DD`. Nessuna legge l'orologio del browser: «oggi» arriva sempre
 * dal server (`Dashboard.today`).
 */

const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const longMonthFormatter = new Intl.DateTimeFormat('it-IT', { month: 'long', timeZone: 'UTC' });
const shortMonthFormatter = new Intl.DateTimeFormat('it-IT', { month: 'short', timeZone: 'UTC' });

/** Da `YYYY-MM-DD` (o `YYYY-MM`) al giorno UTC corrispondente, in millisecondi. */
function utc(date: string): number {
  const [year, month, day = 1] = date.split('-').map(Number) as [number, number, number?];

  return Date.UTC(year, month - 1, day);
}

/** Il mese dell'URL, se è un `YYYY-MM` valido; altrimenti come se mancasse. */
export function parseMonthParam(value: string | null): string | null {
  return value !== null && MONTH_PARAM.test(value) ? value : null;
}

/** Il mese `delta` mesi prima (negativo) o dopo (positivo) di `month`. */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (monthNumber - 1) + delta;

  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Primo e ultimo giorno (inclusi, `YYYY-MM-DD`) del mese `YYYY-MM`. */
export function monthBounds(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * I dati sono da aggiornare: l'ultimo movimento è più vecchio di `days`
 * giorni rispetto a `today`, oppure non ce n'è nessuno.
 */
export function isStale(lastTransactionDate: string | null, today: string, days = 7): boolean {
  if (lastTransactionDate === null) {
    return true;
  }

  return (utc(today) - utc(lastTransactionDate)) / MS_PER_DAY > days;
}

/**
 * La didascalia del confronto sulle uscite.
 *
 * Mese chiuso: «vs agosto». Mese in corso, a parità di giorni: «vs 1–13 set»,
 * con il mese abbreviato in minuscolo.
 */
export function comparisonCaption(window: ComparisonWindow, previousMonth: string): string {
  if (!window.partial) {
    return `vs ${longMonthFormatter.format(utc(previousMonth))}`;
  }

  const firstDay = Number(window.previousFrom.slice(8, 10));
  const lastDay = Number(window.previousTo.slice(8, 10));
  const month = shortMonthFormatter.format(utc(previousMonth)).replace('.', '').toLowerCase();

  return `vs ${firstDay}–${lastDay} ${month}`;
}
