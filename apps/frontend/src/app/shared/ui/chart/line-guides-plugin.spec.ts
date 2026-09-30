import type { Chart } from 'chart.js';
import { describe, expect, it } from 'vitest';
import { lineGuidesPlugin, type LineGuidesOptions } from './line-guides-plugin';

interface Stroke {
  x: number;
  color: string;
  width: number;
  dash: number[];
}

const OPTIONS: LineGuidesOptions = {
  selected: null,
  hover: null,
  styles: {
    selected: { color: 'blue', width: 2, dash: [] },
    hover: { color: 'gray', width: 1, dash: [3, 3] },
  },
};

/** Disegna con un finto grafico e restituisce i tratti registrati dal contesto. */
function draw(options: LineGuidesOptions, labels: readonly string[] = ['a', 'b', 'c', 'd']): Stroke[] {
  const strokes: Stroke[] = [];
  let x = 0;
  let color = '';
  let width = 0;
  let dash: number[] = [];
  const ctx = {
    save: () => undefined,
    beginPath: () => undefined,
    moveTo: (nextX: number) => (x = nextX),
    lineTo: () => undefined,
    setLineDash: (nextDash: number[]) => (dash = nextDash),
    stroke: () => strokes.push({ x, color, width, dash }),
    restore: () => undefined,
    set strokeStyle(value: string) {
      color = value;
    },
    set lineWidth(value: number) {
      width = value;
    },
  };
  const chart = {
    ctx,
    chartArea: { top: 0, bottom: 100 },
    scales: { x: { getPixelForValue: (index: number) => (index + 1) * 10 } },
    data: { labels },
  };

  // Il finto grafico espone solo ciò che il plugin legge.
  lineGuidesPlugin.beforeDatasetsDraw?.(chart as unknown as Chart<'line'>, { cancelable: true }, options);
  return strokes;
}

describe('lineGuidesPlugin', () => {
  it('ha identificativo stabile', () => {
    expect(lineGuidesPlugin.id).toBe('lineGuides');
  });

  it('solo il selezionato: linea piena, larghezza 2', () => {
    expect(draw({ ...OPTIONS, selected: 1 })).toEqual([{ x: 20, color: 'blue', width: 2, dash: [] }]);
  });

  it('solo l\'hover: linea tratteggiata, larghezza 1', () => {
    expect(draw({ ...OPTIONS, hover: 2 })).toEqual([{ x: 30, color: 'gray', width: 1, dash: [3, 3] }]);
  });

  it('entrambi distinti: prima il selezionato, poi l\'hover', () => {
    const strokes = draw({ ...OPTIONS, selected: 1, hover: 2 });

    expect(strokes.map((line) => line.x)).toEqual([20, 30]);
    expect(strokes[0]?.color).not.toBe(strokes[1]?.color);
    expect(strokes[0]?.width).toBe(2);
    expect(strokes[1]?.dash).toEqual([3, 3]);
  });

  it('hover uguale al selezionato: una sola linea', () => {
    expect(draw({ ...OPTIONS, selected: 1, hover: 1 })).toHaveLength(1);
  });

  it('salta gli indici fuori intervallo', () => {
    expect(draw({ ...OPTIONS, selected: 9, hover: -1 })).toEqual([]);
    expect(draw({ ...OPTIONS, selected: 4 })).toEqual([]);
  });

  it('senza etichette non disegna nulla', () => {
    expect(draw({ ...OPTIONS, selected: 0, hover: 1 }, [])).toEqual([]);
  });

  it('senza stili non disegna nulla', () => {
    const partial: Partial<LineGuidesOptions> = { selected: 1, hover: 2 };
    expect(draw(partial as LineGuidesOptions)).toEqual([]);
  });
});
