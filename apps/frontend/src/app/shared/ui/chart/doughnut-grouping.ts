import type { DoughnutSlice } from './doughnut-chart.model';

/**
 * Tiene le prime `topN` voci per valore e raccoglie le altre in una fetta
 * `others`. Le voci non positive non hanno una fetta e si scartano prima del
 * conteggio. Se la voce in eccesso sarebbe una sola, resta una voce normale:
 * "altre (1)" occuperebbe la fetta senza risparmiare nulla.
 */
export function groupTopN<T>(
  items: readonly T[],
  value: (item: T) => number,
  topN: number,
): DoughnutSlice<T>[] {
  // `sort` è stabile: a parità di valore resta l'ordine di ingresso.
  const sorted = items.filter((item) => value(item) > 0).sort((a, b) => value(b) - value(a));

  if (sorted.length <= topN + 1) {
    return sorted.map((item) => ({ kind: 'item', item, value: value(item) }));
  }

  const others = sorted.slice(topN);
  return [
    ...sorted
      .slice(0, topN)
      .map((item): DoughnutSlice<T> => ({ kind: 'item', item, value: value(item) })),
    { kind: 'others', items: others, value: others.reduce((sum, item) => sum + value(item), 0) },
  ];
}
