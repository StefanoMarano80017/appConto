import type { ChartSeriesColor } from './chart.model';

// I colori-serie stanno in `chart.model`: qui restano riesportati per chi li importava dalla linea.
export { CHART_SERIES_COLORS, chartColorVar } from './chart.model';
export type { ChartSeriesColor } from './chart.model';

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
