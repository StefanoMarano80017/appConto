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
}

declare module 'chart.js' {
  // Rende tipizzato `options.plugins.lineGuides`.
  interface PluginOptionsByType<TType extends ChartType> {
    lineGuides?: LineGuidesOptions;
  }
}

/**
 * Guide verticali sul punto selezionato e su quello sotto il puntatore.
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
    const guides = [
      { index: options.selected, stroke: options.styles.selected },
      // Se coincide con il selezionato è già disegnata: niente doppione.
      ...(options.hover === options.selected
        ? []
        : [{ index: options.hover, stroke: options.styles.hover }]),
    ];

    for (const { index, stroke } of guides) {
      if (index === null || index < 0 || index >= labelCount) {
        continue;
      }

      const x = xScale.getPixelForValue(index);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.setLineDash([...stroke.dash]);
      ctx.stroke();
      ctx.restore();
    }
  },
};

/** Costante di modulo: l'identità dell'array è quella che AppChart confronta. */
export const LINE_CHART_PLUGINS: readonly Plugin<'line'>[] = [lineGuidesPlugin];
