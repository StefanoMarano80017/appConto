import { groupTopN } from './doughnut-grouping';

interface Entry {
  id: string;
  v: number;
}
const e = (id: string, v: number): Entry => ({ id, v });
const value = (x: Entry) => x.v;

describe('groupTopN', () => {
  it('non raggruppa se le voci sono al più topN + 1', () => {
    const slices = groupTopN([e('a', 1), e('b', 2), e('c', 3)], value, 2);
    expect(slices.map((s) => s.kind)).toEqual(['item', 'item', 'item']);
  });

  it('raccoglie le voci minori in una fetta others', () => {
    const a = e('a', 10);
    const b = e('b', 40);
    const c = e('c', 5);
    const d = e('d', 20);
    expect(groupTopN([a, b, c, d], value, 2)).toEqual([
      { kind: 'item', item: b, value: 40 },
      { kind: 'item', item: d, value: 20 },
      { kind: 'others', items: [a, c], value: 15 },
    ]);
  });

  it('scarta le voci non positive prima del conteggio', () => {
    const slices = groupTopN([e('a', 3), e('z', 0), e('n', -5), e('b', 2)], value, 1);
    expect(slices.map((s) => s.kind)).toEqual(['item', 'item']);
  });

  it('a parità di valore mantiene l ordine di ingresso', () => {
    const slices = groupTopN([e('a', 5), e('b', 5), e('c', 5)], value, 5);
    expect(slices.map((s) => (s.kind === 'item' ? s.item.id : '?'))).toEqual(['a', 'b', 'c']);
  });

  it('restituisce vuoto senza voci o senza voci positive', () => {
    expect(groupTopN([], value, 3)).toEqual([]);
    expect(groupTopN([e('z', 0), e('n', -1)], value, 3)).toEqual([]);
  });
});
