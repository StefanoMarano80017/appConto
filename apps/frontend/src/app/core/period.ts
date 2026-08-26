/**
 * Periodi di osservazione.
 *
 * La risoluzione di un periodo rapido in due date è una funzione pura del
 * giorno corrente: sta qui, fuori dalle feature, perché Analytics e
 * l'esplorazione dei movimenti osservano lo stesso concetto di periodo.
 */

export type PeriodPreset =
  | 'this-month'
  | 'previous-month'
  | 'last-3-months'
  | 'last-6-months'
  | 'this-year'
  | 'previous-year'
  | 'all'
  | 'custom';

export interface DateRange {
  /** `null` significa "senza limite". */
  from: string | null;
  to: string | null;
}

export const PERIOD_PRESETS: readonly { id: PeriodPreset; label: string }[] = [
  { id: 'this-month', label: 'Questo mese' },
  { id: 'previous-month', label: 'Mese precedente' },
  { id: 'last-3-months', label: 'Ultimi 3 mesi' },
  { id: 'last-6-months', label: 'Ultimi 6 mesi' },
  { id: 'this-year', label: "Quest'anno" },
  { id: 'previous-year', label: 'Anno precedente' },
  { id: 'all', label: 'Tutto' }
];

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  ...(Object.fromEntries(PERIOD_PRESETS.map(({ id, label }) => [id, label])) as Record<
    PeriodPreset,
    string
  >),
  custom: 'Periodo personalizzato'
};

const pad = (value: number): string => String(value).padStart(2, '0');

const iso = (year: number, month: number, day: number): string =>
  `${year}-${pad(month)}-${pad(day)}`;

/** Ultimo giorno del mese indicato (mese 1-12). */
const lastDayOfMonth = (year: number, month: number): number => new Date(year, month, 0).getDate();

const firstOfMonth = (year: number, month: number): string => iso(year, month, 1);
const endOfMonth = (year: number, month: number): string =>
  iso(year, month, lastDayOfMonth(year, month));

/** Il mese indicato, spostato indietro di `months`. */
function monthsBack(year: number, month: number, months: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) - months;

  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

/**
 * Le due date corrispondenti ad un periodo rapido.
 *
 * Gli "ultimi N mesi" partono dal primo giorno del mese N-1 indietro e
 * arrivano alla fine del mese corrente: il periodo copre così esattamente N
 * intervalli mensili, che è ciò che l'andamento nel tempo mostra.
 */
export function resolvePeriod(preset: PeriodPreset, today: Date): DateRange {
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  switch (preset) {
    case 'this-month':
      return { from: firstOfMonth(year, month), to: endOfMonth(year, month) };

    case 'previous-month': {
      const previous = monthsBack(year, month, 1);
      return {
        from: firstOfMonth(previous.year, previous.month),
        to: endOfMonth(previous.year, previous.month)
      };
    }

    case 'last-3-months':
    case 'last-6-months': {
      const start = monthsBack(year, month, preset === 'last-3-months' ? 2 : 5);
      return { from: firstOfMonth(start.year, start.month), to: endOfMonth(year, month) };
    }

    case 'this-year':
      return { from: iso(year, 1, 1), to: iso(year, 12, 31) };

    case 'previous-year':
      return { from: iso(year - 1, 1, 1), to: iso(year - 1, 12, 31) };

    case 'all':
    case 'custom':
      return { from: null, to: null };
  }
}

/**
 * Il periodo rapido corrispondente a due date, se ce n'è uno.
 *
 * Permette di tenere nell'URL solo `from` e `to` — un'unica fonte di verità —
 * e di riconoscere comunque quale pulsante evidenziare.
 */
export function matchingPreset(range: DateRange, today: Date): PeriodPreset {
  const found = PERIOD_PRESETS.find(({ id }) => {
    const resolved = resolvePeriod(id, today);

    return resolved.from === range.from && resolved.to === range.to;
  });

  return found?.id ?? 'custom';
}
