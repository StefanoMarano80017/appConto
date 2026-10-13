/**
 * I colori-serie del design system: `--color-chart-N`. L'elenco è l'unica
 * fonte: il tipo ne deriva, così il tema può risolvere l'insieme chiuso
 * senza cast. Sta qui, e non nel modello della linea, perché lo condividono
 * tutti i grafici.
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

/** Riferimento CSS al colore-serie, per legende e swatch fuori dal canvas. */
export function chartColorVar(color: ChartSeriesColor): `var(--color-${ChartSeriesColor})` {
  return `var(--color-${color})`;
}
