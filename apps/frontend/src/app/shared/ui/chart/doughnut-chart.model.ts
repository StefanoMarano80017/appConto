import type { ChartSeriesColor } from './chart.model';

export type { ChartSeriesColor } from './chart.model';

/**
 * Il colore di una fetta: un colore-serie del design system oppure, per le
 * voci che hanno già un proprio colore (es. una categoria), uno custom.
 */
export type SliceColor = ChartSeriesColor | { readonly custom: string };

/**
 * Una fetta è una voce oppure il raggruppamento delle voci minori: così chi
 * consuma il grafico distingue "le altre" senza inventare una voce finta.
 */
export type DoughnutSlice<T> =
  | { readonly kind: 'item'; readonly item: T; readonly value: number }
  | { readonly kind: 'others'; readonly items: readonly T[]; readonly value: number };
