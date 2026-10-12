/** Segmento di testo: `match` è vero per la parte che corrisponde alla query. */
export interface SearchSegment {
  readonly text: string;
  readonly match: boolean;
}

/** Normalizza un carattere (o una stringa) senza eliminare gli spazi interni. */
const foldChar = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Normalizza per la ricerca: minuscole, senza diacritici, spazi ai bordi rimossi. */
export function normalizeSearch(text: string): string {
  return foldChar(text).trim();
}

/**
 * Cerca `query` in `text` ignorando maiuscole e accenti. Restituisce `null` se non c'è
 * corrispondenza, altrimenti i segmenti del testo originale con la prima occorrenza marcata.
 */
export function matchSegments(text: string, query: string): readonly SearchSegment[] | null {
  const needle = normalizeSearch(query);
  if (needle === '') {
    return [{ text, match: false }];
  }

  // Si normalizza un carattere alla volta: così ogni indice del testo normalizzato
  // punta al carattere originale che lo ha prodotto (es. `è` in NFD vale due code unit).
  const chars = Array.from(text, (char) => ({ char, folded: foldChar(char) }));
  const haystack: string[] = [];
  const owner: number[] = [];
  chars.forEach(({ folded }, index) => {
    for (let unit = 0; unit < folded.length; unit++) {
      owner.push(index);
    }
    haystack.push(folded);
  });

  const start = haystack.join('').indexOf(needle);
  if (start === -1) {
    return null;
  }

  const first = owner[start];
  let last = owner[start + needle.length - 1];
  // I segni diacritici isolati (NFD) hanno una normalizzazione vuota: li si include nel match.
  while (last + 1 < chars.length && chars[last + 1].folded === '') {
    last++;
  }

  const segments: SearchSegment[] = [
    { text: joinChars(chars, 0, first), match: false },
    { text: joinChars(chars, first, last + 1), match: true },
    { text: joinChars(chars, last + 1, chars.length), match: false },
  ];
  return segments.filter((segment) => segment.text !== '');
}

function joinChars(chars: readonly { char: string }[], from: number, to: number): string {
  return chars.slice(from, to).map(({ char }) => char).join('');
}
