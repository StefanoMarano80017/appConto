/**
 * Distribuzione delle spese fra più voci (categorie, merchant).
 *
 * I totali delle uscite sono netti: un rimborso, cioè una spesa con importo
 * positivo, li riduce e può renderli negativi (`expenseCents`). Una
 * distribuzione invece racconta dove sono andati i soldi, e una voce che ha
 * ricevuto più di quanto ha speso non vi ha nulla da mostrare.
 *
 * La regola, una sola per tutte le viste:
 * - restano solo le voci con spesa netta positiva;
 * - la quota di ciascuna è calcolata sulla somma di quelle voci, non sul
 *   totale netto delle uscite, così le quote sommano sempre a 100;
 * - le voci sono ordinate dalla più consistente; a parità d'importo resta
 *   l'ordine di ingresso.
 */

/** Una voce con la sua quota percentuale, un decimale. */
export type DistributionShare<T> = T & { percentage: number };

/** Una frazione espressa in percentuale, con un decimale. */
const percentOf = (fraction: number): number => Math.round(fraction * 1000) / 10;

/** Applica la regola della distribuzione a voci con spesa netta in centesimi. */
export function expenseDistribution<T extends { amountCents: number }>(
  items: Iterable<T>,
): DistributionShare<T>[] {
  const positive = [...items].filter((item) => item.amountCents > 0);
  const baseCents = positive.reduce((sum, item) => sum + item.amountCents, 0);

  return positive
    .sort((a, b) => b.amountCents - a.amountCents)
    .map((item) => ({ ...item, percentage: percentOf(item.amountCents / baseCents) }));
}
