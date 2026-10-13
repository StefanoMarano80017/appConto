import { squarify, type TreemapRect } from './treemap-layout';

const area = (rect: TreemapRect): number => rect.w * rect.h;

/** Area in comune di due rettangoli: zero se si toccano solo sul bordo. */
const overlap = (a: TreemapRect, b: TreemapRect): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

// Una distribuzione tipica delle spese: pochi grandi, una coda di piccoli.
const TYPICAL = [520, 310, 240, 180, 120, 95, 70, 55, 40, 30, 22, 15, 10, 8, 5];

describe('squarify', () => {
  it('le aree sono proporzionali ai valori, in percentuale del contenitore', () => {
    const rects = squarify(TYPICAL, 600, 400);
    const total = TYPICAL.reduce((sum, value) => sum + value, 0);

    expect(rects.length).toBe(TYPICAL.length);
    for (const rect of rects) {
      // Coordinate in %: l'area intera vale 100 × 100.
      expect(area(rect) / 10_000).toBeCloseTo(TYPICAL[rect.index]! / total, 6);
    }
    expect(rects.reduce((sum, rect) => sum + area(rect), 0)).toBeCloseTo(10_000, 6);
  });

  it('i rettangoli stanno dentro il contenitore e non si sovrappongono', () => {
    const rects = squarify(TYPICAL, 600, 400);
    const epsilon = 1e-9;

    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(-epsilon);
      expect(rect.y).toBeGreaterThanOrEqual(-epsilon);
      expect(rect.x + rect.w).toBeLessThanOrEqual(100 + epsilon);
      expect(rect.y + rect.h).toBeLessThanOrEqual(100 + epsilon);
    }
    for (const [i, a] of rects.entries()) {
      for (const b of rects.slice(i + 1)) {
        expect(overlap(a, b)).toBeLessThan(1e-6);
      }
    }
  });

  it('una sola voce riempie tutto il contenitore', () => {
    expect(squarify([42], 600, 400)).toEqual([{ index: 0, x: 0, y: 0, w: 100, h: 100 }]);
  });

  it('valori nulli, negativi o non finiti non hanno un rettangolo; gli indici restano quelli in ingresso', () => {
    const rects = squarify([0, 30, -5, Number.NaN, 10], 600, 400);

    expect(rects.map((rect) => rect.index)).toEqual([1, 4]);
    expect(area(rects[0]!) / area(rects[1]!)).toBeCloseTo(3, 6);
  });

  it('nessuna voce positiva o contenitore vuoto: nessun rettangolo', () => {
    expect(squarify([], 600, 400)).toEqual([]);
    expect(squarify([0, -1], 600, 400)).toEqual([]);
    expect(squarify([10], 0, 400)).toEqual([]);
  });

  it('esce in ordine di valore decrescente, cioè nell’ordine di lettura delle tessere', () => {
    const rects = squarify([10, 50, 30], 600, 400);

    expect(rects.map((rect) => rect.index)).toEqual([1, 2, 0]);
  });

  // Il motivo dell'algoritmo: tessere vicine al quadrato, non strisce.
  it('su una distribuzione tipica le proporzioni restano ragionevoli', () => {
    const width = 600;
    const height = 400;
    const ratios = squarify(TYPICAL, width, height).map((rect) => {
      const w = (rect.w / 100) * width;
      const h = (rect.h / 100) * height;
      return Math.max(w / h, h / w);
    });

    expect(Math.max(...ratios)).toBeLessThan(4);
    // In media molto più vicine al quadrato del peggior caso.
    expect(ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length).toBeLessThan(2);
  });
});
