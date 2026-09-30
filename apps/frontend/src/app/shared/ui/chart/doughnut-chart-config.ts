import type { ChartData } from 'chart.js';
import type { ChartOptionsWithoutInteractionCallbacks } from './chart';
import { DOUGHNUT_CHART_GEOMETRY, type DoughnutChartTheme } from './doughnut-chart-theme';
import type { DoughnutSlice, SliceColor } from './doughnut-chart.model';

/** Un colore custom passa com'è; un token si risolve con il tema corrente. */
function sliceColor(color: SliceColor, theme: DoughnutChartTheme): string {
  return typeof color === 'string' ? theme.series[color] : color.custom;
}

export function doughnutChartData<T>(
  slices: readonly DoughnutSlice<T>[],
  label: (item: T) => string,
  color: (item: T) => SliceColor,
  othersLabel: string,
  theme: DoughnutChartTheme,
): ChartData<'doughnut', number[], string> {
  const geometry = DOUGHNUT_CHART_GEOMETRY;

  return {
    labels: slices.map((slice) => (slice.kind === 'item' ? label(slice.item) : othersLabel)),
    datasets: [
      {
        data: slices.map((slice) => slice.value),
        // «Altri» è sempre neutro: non ha un colore proprio da chiedere a chi consuma.
        backgroundColor: slices.map((slice) =>
          slice.kind === 'item' ? sliceColor(color(slice.item), theme) : theme.series['chart-neutral'],
        ),
        borderColor: theme.sliceBorder,
        borderWidth: geometry.borderWidth,
        hoverOffset: geometry.hoverOffset,
      },
    ],
  };
}

/**
 * Niente animazione, legenda e tooltip di Chart.js: legenda e dettaglio sono
 * HTML del componente, accessibili e nel design system.
 */
export function doughnutChartOptions(): ChartOptionsWithoutInteractionCallbacks<'doughnut'> {
  return {
    cutout: DOUGHNUT_CHART_GEOMETRY.cutout,
    animation: false,
    maintainAspectRatio: false,
    layout: { padding: DOUGHNUT_CHART_GEOMETRY.layoutPadding },
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
  };
}
