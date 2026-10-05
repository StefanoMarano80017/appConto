import { resolveSeriesColors } from './chart-theme';
import type { ChartSeriesColor } from './chart.model';

/*
 * Interno al layer del grafico: le feature non lo importano.
 *
 * Qui vivono i NOMI dei token, mai i valori: i colori li risolve il design
 * system a runtime, così il cambio di tema non richiede nulla al grafico.
 */

/** Token semantici usati dal canvas, per ruolo. */
export const DOUGHNUT_CHART_TOKENS = {
  sliceBorder: '--color-surface',
} as const satisfies Record<string, `--color-${string}`>;

/**
 * La geometria non cambia col tema (il tema cambia solo i colori), quindi sta
 * in una costante. `layoutPadding` uguaglia `hoverOffset` perché la fetta
 * sollevata all'hover non venga tagliata dal bordo del canvas.
 */
export const DOUGHNUT_CHART_GEOMETRY = {
  cutout: '68%',
  borderWidth: 2,
  hoverOffset: 6,
  layoutPadding: 6,
} as const;

/**
 * Quando alcune voci sono evidenziate, le altre fette restano al loro posto
 * ma col colore attenuato: opacità e non un altro colore, così ciascuna resta
 * riconoscibile. Come la geometria, non cambia col tema.
 */
export const DOUGHNUT_CHART_DIMMED_ALPHA = 0.3;

/**
 * Valori risolti. Un colore mancante resta la stringa vuota, che Chart.js
 * tratta come «usa il default»: nessun ripiego esadecimale.
 */
export interface DoughnutChartTheme {
  readonly sliceBorder: string;
  readonly series: Readonly<Record<ChartSeriesColor, string>>;
}

/** Pura: legge da qualunque oggetto con `getPropertyValue`, così si testa senza DOM. */
export function resolveDoughnutChartTheme(
  style: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
): DoughnutChartTheme {
  return {
    sliceBorder: style.getPropertyValue(DOUGHNUT_CHART_TOKENS.sliceBorder).trim(),
    series: resolveSeriesColors(style),
  };
}
