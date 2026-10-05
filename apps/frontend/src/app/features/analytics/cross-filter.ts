import { AnalyticsQueryState } from './analytics.store';

/** Le dimensioni che hanno una propria ripartizione nella pagina. */
export type CrossFilterDimension = 'category' | 'merchant';

/**
 * La query di una ripartizione: quella dell'analisi, senza il filtro della
 * dimensione che la ripartizione stessa mostra (cross-filter).
 *
 * Filtrata una categoria, la ciambella deve ancora contenere le altre per
 * avere qualcosa con cui confrontarla: ignora i propri filtri e rispetta
 * tutti gli altri — periodo, tipi, l'altra dimensione e il passo.
 *
 * La classificazione fa parte della dimensione delle categorie: «Da
 * classificare» è una fetta della ciambella come le altre, quindi il suo
 * filtro cade insieme a quello delle categorie.
 */
export function crossFilterQuery(
  query: AnalyticsQueryState,
  dimension: CrossFilterDimension
): AnalyticsQueryState {
  return dimension === 'category'
    ? { ...query, categoryIds: [], classification: 'all' }
    : { ...query, merchantIds: [] };
}

/**
 * Se la ripartizione ha bisogno di una richiesta tutta sua: solo quando un
 * filtro della propria dimensione è attivo. Altrimenti la sua query coincide
 * con quella principale, e ne legge la risposta.
 */
export function needsCrossFilter(
  query: AnalyticsQueryState,
  dimension: CrossFilterDimension
): boolean {
  return dimension === 'category'
    ? query.categoryIds.length > 0 || query.classification !== 'all'
    : query.merchantIds.length > 0;
}
