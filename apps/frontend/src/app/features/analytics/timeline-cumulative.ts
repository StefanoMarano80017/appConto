import { TimelineBucket } from './analytics.model';

/** Un punto della vista cumulata: la variazione dell'intervallo e la somma fin lì. */
export interface CumulativePoint {
  /** Entrate meno uscite dell'intervallo. */
  readonly change: number;
  /** Somma delle variazioni dal primo intervallo a questo, compreso. */
  readonly cumulative: number;
}

const toCents = (amount: number): number => Math.round(amount * 100);

/**
 * Il saldo netto del periodo, intervallo per intervallo.
 *
 * È la stessa grandezza del KPI «Saldo netto» (`overview.balance` = entrate
 * meno uscite), non `netMovement`: prelievi, trasferimenti e prestiti restano
 * fuori, perché non sono un risultato economico. Per costruzione l'ultimo
 * cumulato è quindi il KPI del periodo.
 *
 * `expenses` è una magnitudine di spesa (positiva; v. `AnalyticsOverview`, e
 * il grafico dei flussi la nega solo per la resa testuale), non un valore con
 * segno: va sottratta. Un rimborso netto la rende negativa, e sottrarla fa
 * salire il cumulato, come deve.
 *
 * Si somma in centesimi interi: in virgola mobile 0,1 + 0,2 non fa 0,3, e
 * dopo qualche decina di intervalli l'ultimo punto si scosterebbe dal KPI.
 */
export function cumulativeNet(buckets: readonly TimelineBucket[]): CumulativePoint[] {
  let cents = 0;

  return buckets.map((bucket) => {
    const change = toCents(bucket.income) - toCents(bucket.expenses);
    cents += change;
    return { change: change / 100, cumulative: cents / 100 };
  });
}
