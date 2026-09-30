/**
 * I colori-serie del design system: `--color-chart-N`. L'elenco è l'unica
 * fonte: il tipo ne deriva, così il tema può risolvere l'insieme chiuso
 * senza cast.
 */
export const CHART_SERIES_COLORS = [
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
  'chart-7',
  'chart-neutral',
] as const;

export type ChartSeriesColor = (typeof CHART_SERIES_COLORS)[number];

export interface LineSeries<T, K extends string = string> {
  readonly key: K;
  readonly label: string;
  readonly color: ChartSeriesColor;
  readonly value: (point: T) => number;
}

/**
 * `auto` = regola di densità comune; `hollow` = sempre visibile, vuoto.
 * Estensione: un eventuale `hidden` si aggiunge qui e nel builder dei punti.
 */
export type LinePointMarker = 'auto' | 'hollow';

/**
 * L'asse Y tiene insieme formato e politica di scala. Estensione: un asse
 * `percent` si aggiunge qui, con il proprio formato e la propria scala.
 */
export type LineChartValueAxis = 'amount';

/** Riferimento CSS al colore-serie, per legende e swatch fuori dal canvas. */
export function chartColorVar(color: ChartSeriesColor): `var(--color-${ChartSeriesColor})` {
  return `var(--color-${color})`;
}
