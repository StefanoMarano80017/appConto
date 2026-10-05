import type { ChartData, ChartDataset } from 'chart.js';
import { formatAmount } from '../../../core/format';
import type { ChartOptionsWithoutInteractionCallbacks } from './chart';
import { LINE_CHART_GEOMETRY, type LineChartFont, type LineChartTheme } from './line-chart-theme';
import type { LineChartValueAxis, LinePointMarker, LineSeries } from './line-chart.model';
import type { LineGuidesState } from './line-guides-plugin';
import { niceScale } from './value-scale';

/**
 * Formato e scala dell'asse Y stanno insieme, così non si possono
 * abbinare male. Un asse `percent` si aggiunge qui, con il proprio formato e la propria scala.
 */
const VALUE_AXES = {
  amount: { format: (value: number) => formatAmount(value), scale: niceScale },
} satisfies Record<
  LineChartValueAxis,
  { format: (value: number) => string; scale: (values: readonly number[]) => { min: number; max: number; ticks: readonly number[] } }
>;

/** Un solo punto di verità per famiglia, dimensione e peso: i valori assenti si omettono. */
function chartFont(font: LineChartFont): { family?: string; size?: number; weight?: number } {
  return {
    ...(font.family === '' ? {} : { family: font.family }),
    ...(font.size === undefined ? {} : { size: font.size }),
    ...(font.weight === undefined ? {} : { weight: font.weight }),
  };
}

export function lineChartData<T>(
  points: readonly T[],
  series: readonly LineSeries<T>[],
  marker: (point: T) => LinePointMarker,
  xLabel: (point: T) => string,
  theme: LineChartTheme,
): ChartData<'line', number[], string> {
  const geometry = LINE_CHART_GEOMETRY;

  const datasets = series.map((item) => {
    const color = theme.series[item.color];

    return {
      label: item.label,
      data: points.map((point) => item.value(point)),
      borderColor: color,
      borderWidth: geometry.lineWidth,
      borderCapStyle: geometry.lineCap,
      borderJoinStyle: geometry.lineJoin,
      pointRadius: points.map((point, index) =>
        points.length <= geometry.markersMaxPoints ||
        marker(point) === 'hollow' ||
        index === 0 ||
        index === points.length - 1
          ? geometry.pointRadius
          : 0,
      ),
      pointHoverRadius: geometry.pointHoverRadius,
      pointBorderWidth: geometry.pointBorderWidth,
      pointBorderColor: color,
      pointBackgroundColor: points.map((point) =>
        marker(point) === 'hollow' ? theme.hollowFill : color,
      ),
      tension: geometry.tension,
      fill: false,
    } satisfies ChartDataset<'line', number[]>;
  });

  return { labels: points.map((point) => xLabel(point)), datasets };
}

/** Intervallo dell'asse Y per i valori disegnati (elenco piatto di tutte le serie). */
export function lineChartValueRange(
  axis: LineChartValueAxis,
  values: readonly number[],
): { min: number; max: number } {
  return VALUE_AXES[axis].scale(values);
}

/**
 * `range` è l'intervallo già calcolato con `lineChartValueRange`: si calcola
 * a parte perché non dipende dall'hover e le opzioni si rifanno a ogni
 * movimento del puntatore. `zeroLine` aggiunge alle guide la linea dello
 * zero; spenta, la chiave non c'è proprio e il plugin non la disegna.
 */
export function lineChartOptions(
  theme: LineChartTheme,
  axis: LineChartValueAxis,
  range: { min: number; max: number; ticks?: readonly number[] },
  guides: LineGuidesState,
  zeroLine = false,
): ChartOptionsWithoutInteractionCallbacks {
  const geometry = LINE_CHART_GEOMETRY;
  const { format } = VALUE_AXES[axis];
  const { min, max, ticks } = range;

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: geometry.layoutPadding },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
      lineGuides: {
        ...guides,
        styles: {
          selected: { color: theme.guideSelected, ...geometry.guideSelected },
          hover: { color: theme.guideHover, ...geometry.guideHover },
        },
        ...(zeroLine ? { zero: { color: theme.zeroLine, ...geometry.zeroLine } } : {}),
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: theme.axisText,
          maxTicksLimit: geometry.maxXTicks,
          maxRotation: 0,
          autoSkip: true,
          font: chartFont(theme.labelFont),
        },
      },
      y: {
        min,
        max,
        // L'asse segue i dati: le linee guida tonde le decide la scala, non Chart.js.
        ...(ticks === undefined
          ? {}
          : {
              afterBuildTicks: (scale: { ticks: { value: number }[] }) => {
                scale.ticks = ticks.map((value) => ({ value }));
              },
            }),
        border: { display: false },
        grid: { color: theme.grid, drawTicks: false },
        ticks: {
          color: theme.axisText,
          maxTicksLimit: geometry.maxYTicks,
          padding: geometry.yTickPadding,
          font: chartFont(theme.valueFont),
          callback: (value) => format(Number(value)),
        },
      },
    },
  };
}
