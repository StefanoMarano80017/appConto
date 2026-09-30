import { describe, expect, it } from 'vitest';
import { doughnutChartData, doughnutChartOptions } from './doughnut-chart-config';
import type { DoughnutChartTheme } from './doughnut-chart-theme';
import type { DoughnutSlice } from './doughnut-chart.model';

interface Voce {
  readonly nome: string;
}

const tema: DoughnutChartTheme = {
  sliceBorder: 'rgb(1, 1, 1)',
  series: {
    'chart-1': 'rgb(11)',
    'chart-2': 'rgb(22)',
    'chart-3': 'rgb(33)',
    'chart-4': 'rgb(44)',
    'chart-5': 'rgb(55)',
    'chart-6': 'rgb(66)',
    'chart-7': 'rgb(77)',
    'chart-neutral': 'rgb(99)',
  },
};

const A: Voce = { nome: 'A' };
const B: Voce = { nome: 'B' };

describe('doughnutChartData', () => {
  const fette: DoughnutSlice<Voce>[] = [
    { kind: 'item', item: A, value: 50 },
    { kind: 'item', item: B, value: 30 },
    { kind: 'others', items: [{ nome: 'C' }], value: 20 },
  ];

  it('costruisce etichette, valori, colori e stile del dataset', () => {
    const dati = doughnutChartData(
      fette,
      (voce) => voce.nome,
      (voce) => (voce === A ? { custom: '#123456' } : 'chart-2'),
      'Altri',
      tema,
    );
    expect(dati.labels).toEqual(['A', 'B', 'Altri']);
    expect(dati.datasets).toHaveLength(1);
    const [dataset] = dati.datasets;
    expect(dataset.data).toEqual([50, 30, 20]);
    expect(dataset.backgroundColor).toEqual(['#123456', 'rgb(22)', 'rgb(99)']);
    expect(dataset.borderColor).toBe('rgb(1, 1, 1)');
    expect(dataset.borderWidth).toBe(2);
    expect(dataset.hoverOffset).toBe(6);
  });
});

describe('doughnutChartOptions', () => {
  it('imposta geometria e spegne animazione, legenda e tooltip nativi', () => {
    const opzioni = doughnutChartOptions();
    expect(opzioni.cutout).toBe('68%');
    expect(opzioni.animation).toBe(false);
    expect(opzioni.maintainAspectRatio).toBe(false);
    expect(opzioni.plugins?.legend?.display).toBe(false);
    expect(opzioni.plugins?.tooltip?.enabled).toBe(false);
    expect(opzioni.layout?.padding).toBe(6);
  });
});
