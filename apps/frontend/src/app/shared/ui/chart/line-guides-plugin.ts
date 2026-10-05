import type { ChartType, Plugin } from 'chart.js';

/** Gli indici da evidenziare: il punto selezionato e quello sotto il puntatore. */
export interface LineGuidesState {
  readonly selected: number | null;
  readonly hover: number | null;
}

export interface LineGuideStroke {
  readonly color: string;
  readonly width: number;
  readonly dash: readonly number[];
}

export interface LineGuidesOptions extends LineGuidesState {
  readonly styles: {
    readonly selected: LineGuideStroke;
    readonly hover: LineGuideStroke;
  };
  /**
   * Linea orizzontale sullo zero, da un bordo all'altro dell'area dati.
   * Assente = non si disegna: la chiede chi ha una serie che attraversa lo
   * zero e su cui «sopra o sotto» è la lettura principale (es. un cumulato).
   */
  readonly zero?: LineGuideStroke;
}

declare module 'chart.js' {
  // Rende tipizzato `options.plugins.lineGuides`.
  interface PluginOptionsByType<TType extends ChartType> {
    lineGuides?: LineGuidesOptions;
  }
}

/**
 * Guide verticali sul punto selezionato e su quello sotto il puntatore, e,
 * se chiesta, la linea dello zero.
 *
 * Non ha stato proprio: legge tutto dalle opzioni, così ha un'identità stabile
 * (un cambio di plugin ricreerebbe il grafico) e si ridisegna quando cambiano
 * le opzioni.
 */
export const lineGuidesPlugin: Plugin<'line', LineGuidesOptions> = {
  id: 'lineGuides',
  beforeDatasetsDraw(chart, _args, options) {
    // Il plugin può essere registrato su un grafico che non definisce `lineGuides`.
    if (!options?.styles) {
      return;
    }

    const labelCount = chart.data.labels?.length ?? 0;
    const xScale = chart.scales['x'];
    if (labelCount === 0 || !xScale) {
      return;
    }

    const { ctx, chartArea } = chart;

    // Prima delle guide verticali, così il punto scelto resta sopra lo zero.
    // Fuori scala non si disegna: schiacciata sul bordo direbbe il falso.
    const yScale = chart.scales['y'];
    if (options.zero && yScale && yScale.min <= 0 && yScale.max >= 0) {
      const y = yScale.getPixelForValue(0);
      stroke(ctx, options.zero, [chartArea.left, y], [chartArea.right, y]);
    }

    const guides = [
      { index: options.selected, stroke: options.styles.selected },
      // Se coincide con il selezionato è già disegnata: niente doppione.
      ...(options.hover === options.selected
        ? []
        : [{ index: options.hover, stroke: options.styles.hover }]),
    ];

    for (const { index, stroke: style } of guides) {
      if (index === null || index < 0 || index >= labelCount) {
        continue;
      }

      const x = xScale.getPixelForValue(index);
      stroke(ctx, style, [x, chartArea.top], [x, chartArea.bottom]);
    }
  },
};

function stroke(
  ctx: CanvasRenderingContext2D,
  style: LineGuideStroke,
  from: readonly [number, number],
  to: readonly [number, number],
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.setLineDash([...style.dash]);
  ctx.stroke();
  ctx.restore();
}

/** Costante di modulo: l'identità dell'array è quella che AppChart confronta. */
export const LINE_CHART_PLUGINS: readonly Plugin<'line'>[] = [lineGuidesPlugin];
