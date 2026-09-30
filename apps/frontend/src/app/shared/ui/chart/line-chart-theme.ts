import type { ChartSeriesColor } from './line-chart.model';

/*
 * Interno al layer del grafico: le feature non lo importano.
 *
 * Qui vivono i NOMI dei token, mai i valori: i colori li risolve il design
 * system a runtime, così il cambio di tema non richiede nulla al grafico.
 */

/** Token semantici usati dal canvas, per ruolo. */
export const LINE_CHART_TOKENS = {
  axisText: '--color-text-muted',
  grid: '--color-border',
  hollowFill: '--color-surface',
  guideSelected: '--color-primary',
  guideHover: '--color-text-muted',
} as const satisfies Record<string, `--color-${string}`>;

/** Il token di una serie, derivato dal tipo chiuso dei colori-serie. */
export function seriesColorToken(color: ChartSeriesColor): `--color-${ChartSeriesColor}` {
  return `--color-${color}`;
}

/**
 * Prefissi delle custom property tipografiche (vedi `role-properties` in
 * `_typography.scss`), da emettere sull'host del componente: etichette
 * dell'asse X (ruolo `caption`) e valori dell'asse Y (ruolo
 * `financial-row`, numerali finanziari — DESIGN_SYSTEM §4).
 */
export const LINE_CHART_FONT_PREFIXES = {
  label: 'chart-label',
  value: 'chart-value',
} as const;

/**
 * La geometria non cambia col tema (il tema cambia solo i colori), quindi sta
 * in una costante e non nelle custom property.
 */
export const LINE_CHART_GEOMETRY = {
  lineWidth: 2,
  lineCap: 'round',
  lineJoin: 'round',
  tension: 0,
  pointRadius: 3,
  pointHoverRadius: 5,
  pointBorderWidth: 2,
  /** Oltre questa soglia i marcatori restano solo sul primo e sull'ultimo punto. */
  markersMaxPoints: 24,
  maxXTicks: 9,
  maxYTicks: 6,
  yTickPadding: 10,
  layoutPadding: { top: 8, right: 8, bottom: 0, left: 0 },
  guideSelected: { width: 2, dash: [] },
  guideHover: { width: 1, dash: [3, 3] },
} as const;

/**
 * Un font risolto. `size` e `weight` sono `undefined` quando la custom
 * property manca o non è numerica (ambiente senza il foglio di stile, come
 * jsdom): un `NaN` romperebbe Chart.js, mentre `undefined` gli lascia il
 * proprio default senza che qui si inventi un valore di design.
 */
export interface LineChartFont {
  readonly family: string;
  readonly size: number | undefined;
  readonly weight: number | undefined;
}

/**
 * Valori risolti. Un colore mancante resta la stringa vuota, che Chart.js
 * tratta come «usa il default»: nessun ripiego esadecimale, perché un colore
 * inventato qui sarebbe un secondo design system.
 */
export interface LineChartTheme {
  readonly axisText: string;
  readonly grid: string;
  readonly hollowFill: string;
  readonly guideSelected: string;
  readonly guideHover: string;
  readonly labelFont: LineChartFont;
  readonly valueFont: LineChartFont;
  readonly series: Readonly<Record<ChartSeriesColor, string>>;
}

function toNumber(text: string): number | undefined {
  const value = parseFloat(text);
  return Number.isFinite(value) ? value : undefined;
}

/** Pura: legge da qualunque oggetto con `getPropertyValue`, così si testa senza DOM. */
export function resolveLineChartTheme(
  style: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
): LineChartTheme {
  const read = (name: string): string => style.getPropertyValue(name).trim();
  const seriesColor = (color: ChartSeriesColor): string => read(seriesColorToken(color));
  const font = (prefix: string): LineChartFont => ({
    family: read(`--${prefix}-font-family`),
    size: toNumber(read(`--${prefix}-font-size`)),
    weight: toNumber(read(`--${prefix}-font-weight`)),
  });

  return {
    axisText: read(LINE_CHART_TOKENS.axisText),
    grid: read(LINE_CHART_TOKENS.grid),
    hollowFill: read(LINE_CHART_TOKENS.hollowFill),
    guideSelected: read(LINE_CHART_TOKENS.guideSelected),
    guideHover: read(LINE_CHART_TOKENS.guideHover),
    labelFont: font(LINE_CHART_FONT_PREFIXES.label),
    valueFont: font(LINE_CHART_FONT_PREFIXES.value),
    // Letterale e non costruito in ciclo: così il compilatore verifica che l'insieme chiuso sia coperto, senza cast.
    series: {
      'chart-1': seriesColor('chart-1'),
      'chart-2': seriesColor('chart-2'),
      'chart-3': seriesColor('chart-3'),
      'chart-4': seriesColor('chart-4'),
      'chart-5': seriesColor('chart-5'),
      'chart-6': seriesColor('chart-6'),
      'chart-7': seriesColor('chart-7'),
      'chart-neutral': seriesColor('chart-neutral'),
    },
  };
}
