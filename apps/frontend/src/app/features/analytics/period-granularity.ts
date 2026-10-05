import { DateRange } from '../../core/period';
import { TimelineGranularity } from './analytics.model';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Giorni del periodo, estremi inclusi, contati in UTC per non risentire dell'ora legale. */
function lengthInDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/**
 * Il passo più comodo per leggere un periodo. La granularità raggruppa i
 * punti del grafico, non filtra nulla: si sceglie in modo che il periodo
 * abbia un numero leggibile di punti (al più circa 31 giorni, 27 settimane
 * o pochi mesi). Con un estremo aperto la lunghezza non è nota: mesi.
 *
 * La soglia delle settimane è 186 giorni e non 183: il preset 6M dura da 181 a
 * 184 giorni a seconda dei mesi e deve restare sempre per settimane.
 */
export function comfortableGranularity(range: DateRange): TimelineGranularity {
  if (range.from === null || range.to === null) {
    return 'month';
  }

  const days = lengthInDays(range.from, range.to);
  if (days <= 31) {
    return 'day';
  }

  return days <= 186 ? 'week' : 'month';
}
