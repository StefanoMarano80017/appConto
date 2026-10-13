/**
 * Un rettangolo della treemap, in percentuale del contenitore: `x` e `w` della
 * larghezza, `y` e `h` dell'altezza. Così il layout si scrive in CSS con `%` e
 * segue il contenitore da sé. `index` è la posizione del valore in ingresso.
 */
export interface TreemapRect {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface Entry {
  readonly index: number;
  /** Area in unità del contenitore (larghezza × altezza), non il valore. */
  readonly area: number;
}

/**
 * Treemap «squarified» (Bruls, Huizing, van Wijk, 2000): le aree sono
 * proporzionali ai valori e le tessere restano il più possibile vicine al
 * quadrato, che è ciò che rende confrontabili due aree a occhio.
 *
 * Le voci, dalla più grande, riempiono una striscia lungo il lato corto dello
 * spazio rimasto finché aggiungerne una peggiorerebbe la proporzione più
 * sbilanciata della striscia; allora la striscia si chiude e si riparte.
 *
 * `width` e `height` servono solo per le proporzioni (le tessere sono quadrate
 * nei pixel veri, non nelle percentuali); il risultato è normalizzato. Valori
 * non positivi o non finiti non hanno un rettangolo. L'uscita è in ordine di
 * valore decrescente (a parità, l'ordine di ingresso).
 */
export function squarify(values: readonly number[], width: number, height: number): TreemapRect[] {
  const positive = values
    .map((value, index) => ({ index, value }))
    .filter(({ value }) => Number.isFinite(value) && value > 0)
    // `sort` è stabile: a parità di valore resta l'ordine di ingresso.
    .sort((a, b) => b.value - a.value);
  if (positive.length === 0 || !(width > 0) || !(height > 0)) {
    return [];
  }

  const total = positive.reduce((sum, { value }) => sum + value, 0);
  const scale = (width * height) / total;
  const entries: Entry[] = positive.map(({ index, value }) => ({ index, area: value * scale }));

  const rects: TreemapRect[] = [];
  // Lo spazio ancora libero, in unità del contenitore.
  let free = { x: 0, y: 0, w: width, h: height };
  let row: Entry[] = [];

  const closeRow = (last: boolean): void => {
    const { placed, rest } = layoutRow(row, free, last);
    rects.push(...placed);
    free = rest;
    row = [];
  };

  for (const entry of entries) {
    const side = Math.min(free.w, free.h);
    if (row.length > 0 && worstRatio([...row, entry], side) > worstRatio(row, side)) {
      closeRow(false);
    }
    row.push(entry);
  }
  closeRow(true);

  return rects.map((rect) => ({
    index: rect.index,
    x: (rect.x / width) * 100,
    y: (rect.y / height) * 100,
    w: (rect.w / width) * 100,
    h: (rect.h / height) * 100,
  }));
}

/** La proporzione peggiore (lato lungo / lato corto) di una striscia appoggiata su `side`. */
function worstRatio(row: readonly Entry[], side: number): number {
  const sum = row.reduce((total, { area }) => total + area, 0);
  const largest = Math.max(...row.map(({ area }) => area));
  const smallest = Math.min(...row.map(({ area }) => area));
  const sideSquared = side * side;

  return Math.max((sideSquared * largest) / (sum * sum), (sum * sum) / (sideSquared * smallest));
}

/**
 * Dispone la striscia lungo il lato corto dello spazio libero e restituisce
 * lo spazio che resta. L'ultima tessera della striscia arriva fino al bordo,
 * e l'ultima striscia (`last`) occupa tutto lo spazio rimasto: gli errori di
 * arrotondamento non lasciano fessure né sbordano.
 */
function layoutRow(
  row: readonly Entry[],
  free: { x: number; y: number; w: number; h: number },
  last: boolean,
): { placed: TreemapRect[]; rest: { x: number; y: number; w: number; h: number } } {
  const sum = row.reduce((total, { area }) => total + area, 0);
  const placed: TreemapRect[] = [];

  if (free.w >= free.h) {
    // Colonna a sinistra, alta quanto lo spazio libero.
    const thickness = last ? free.w : sum / free.h;
    let offset = 0;
    row.forEach(({ index, area }, i) => {
      const length = i === row.length - 1 ? free.h - offset : area / thickness;
      placed.push({ index, x: free.x, y: free.y + offset, w: thickness, h: length });
      offset += length;
    });
    return {
      placed,
      rest: { x: free.x + thickness, y: free.y, w: Math.max(free.w - thickness, 0), h: free.h },
    };
  }

  // Riga in alto, larga quanto lo spazio libero.
  const thickness = last ? free.h : sum / free.w;
  let offset = 0;
  row.forEach(({ index, area }, i) => {
    const length = i === row.length - 1 ? free.w - offset : area / thickness;
    placed.push({ index, x: free.x + offset, y: free.y, w: length, h: thickness });
    offset += length;
  });
  return {
    placed,
    rest: { x: free.x, y: free.y + thickness, w: free.w, h: Math.max(free.h - thickness, 0) },
  };
}
