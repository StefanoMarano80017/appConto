/**
 * Il testo come lo confronta la ricerca.
 *
 * Minuscolo (anche oltre l'ASCII), scomposto in lettera più segno (NFD) e
 * privato dei segni diacritici: «CAFFÈ» e «caffe» diventano entrambi «caffe».
 *
 * È l'unica definizione: la registra `db/client.ts` come funzione SQLite
 * (`fold_search`, per la colonna) e la usano i repository sul termine
 * cercato, così i due lati del confronto concordano per costruzione.
 */
export function foldSearchText(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}
