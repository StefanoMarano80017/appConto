import type { ChartSeriesColor } from './chart.model';

/*
 * Interno al layer dei grafici: le feature non lo importano.
 *
 * Ciò che ogni grafico risolve allo stesso modo dal design system: i colori
 * delle serie. Qui vivono i NOMI dei token, mai i valori.
 */

/** Il token di una serie, derivato dal tipo chiuso dei colori-serie. */
export function seriesColorToken(color: ChartSeriesColor): `--color-${ChartSeriesColor}` {
  return `--color-${color}`;
}

/**
 * Pura: legge da qualunque oggetto con `getPropertyValue`, così si testa senza
 * DOM. Un token mancante resta la stringa vuota, che Chart.js tratta come
 * «usa il default»: nessun ripiego esadecimale.
 */
export function resolveSeriesColors(
  style: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
): Readonly<Record<ChartSeriesColor, string>> {
  const seriesColor = (color: ChartSeriesColor): string =>
    style.getPropertyValue(seriesColorToken(color)).trim();

  // Letterale e non costruito in ciclo: così il compilatore verifica che l'insieme chiuso sia coperto, senza cast.
  return {
    'chart-1': seriesColor('chart-1'),
    'chart-2': seriesColor('chart-2'),
    'chart-3': seriesColor('chart-3'),
    'chart-4': seriesColor('chart-4'),
    'chart-5': seriesColor('chart-5'),
    'chart-6': seriesColor('chart-6'),
    'chart-7': seriesColor('chart-7'),
    'chart-neutral': seriesColor('chart-neutral'),
  };
}
