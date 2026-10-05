import type { ChartData } from 'chart.js';
import { color as parseColor } from 'chart.js/helpers';
import type { ChartOptionsWithoutInteractionCallbacks } from './chart';
import {
  DOUGHNUT_CHART_DIMMED_ALPHA,
  DOUGHNUT_CHART_GEOMETRY,
  type DoughnutChartTheme,
} from './doughnut-chart-theme';
import type { DoughnutSlice, SliceColor } from './doughnut-chart.model';

/** Un colore custom passa com'è; un token si risolve con il tema corrente. */
function sliceColor(color: SliceColor, theme: DoughnutChartTheme): string {
  return typeof color === 'string' ? theme.series[color] : color.custom;
}

/**
 * Lo stesso colore con l'opacità ridotta. Un colore che non si sa leggere
 * (es. il token mancante, la stringa vuota) resta com'è: meglio una fetta
 * non attenuata che un colore inventato.
 */
function dimmed(value: string): string {
  const parsed = parseColor(value);
  return parsed.valid ? parsed.alpha(DOUGHNUT_CHART_DIMMED_ALPHA).rgbString() : value;
}

/** «Altri» è evidenziata se lo è una delle voci che raggruppa. */
function isHighlighted<T>(slice: DoughnutSlice<T>, highlighted: (item: T) => boolean): boolean {
  return slice.kind === 'item' ? highlighted(slice.item) : slice.items.some(highlighted);
}

export function doughnutChartData<T>(
  slices: readonly DoughnutSlice<T>[],
  label: (item: T) => string,
  color: (item: T) => SliceColor,
  othersLabel: string,
  theme: DoughnutChartTheme,
  highlighted?: (item: T) => boolean,
): ChartData<'doughnut', number[], string> {
  const geometry = DOUGHNUT_CHART_GEOMETRY;

  // Si attenua solo se c'è qualcosa da far risaltare: senza fette evidenziate
  // la ciambella intera sbiadita non direbbe nulla.
  const emphasis = highlighted ? slices.map((slice) => isHighlighted(slice, highlighted)) : [];
  const dim = emphasis.some(Boolean);

  return {
    labels: slices.map((slice) => (slice.kind === 'item' ? label(slice.item) : othersLabel)),
    datasets: [
      {
        data: slices.map((slice) => slice.value),
        // «Altri» è sempre neutro: non ha un colore proprio da chiedere a chi consuma.
        backgroundColor: slices.map((slice, index) => {
          const base =
            slice.kind === 'item'
              ? sliceColor(color(slice.item), theme)
              : theme.series['chart-neutral'];
          return dim && !emphasis[index] ? dimmed(base) : base;
        }),
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
