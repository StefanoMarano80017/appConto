import type { SliceColor } from './doughnut-chart.model';

export type { ChartSeriesColor } from './chart.model';

/**
 * Il colore di una tessera: lo stesso contratto delle fette della ciambella,
 * così una feature colora categorie e merchant con la stessa funzione. Un
 * colore-serie del design system, oppure uno custom (es. quello di una categoria).
 */
export type TileColor = SliceColor;

/**
 * Ciò che si è attivato: una voce, oppure la tessera che raggruppa le voci
 * minori. «Altri» non è una voce: chi consuma la treemap decide che farne.
 */
export type TreemapActivation<T> =
  | { readonly kind: 'item'; readonly item: T }
  | { readonly kind: 'others'; readonly items: readonly T[] };
