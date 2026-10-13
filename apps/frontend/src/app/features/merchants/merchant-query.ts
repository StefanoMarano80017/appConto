import { ParamMap, Params } from '@angular/router';
import { PAGE_SIZES } from '@shared/ui/data/pagination/pagination.model';
import { ClassificationFilter, SortDirection } from '../transactions/transaction-query';

export type { ClassificationFilter, SortDirection };

/**
 * Criteri di ricerca dei merchant.
 *
 * Vivono nella query string, come per i movimenti: l'URL è l'unica fonte di
 * verità della pagina.
 */

export const MERCHANT_SORT_FIELDS = [
  'name',
  'category',
  'transactionCount',
  'totalSpent',
  'lastTransactionDate'
] as const;

export type MerchantSortField = (typeof MERCHANT_SORT_FIELDS)[number];

/** La direzione con cui parte una colonna appena scelta. */
export const FIRST_SORT_DIRECTION: Record<MerchantSortField, SortDirection> = {
  name: 'asc',
  category: 'asc',
  transactionCount: 'desc',
  totalSpent: 'desc',
  lastTransactionDate: 'desc'
};

export interface MerchantQueryState {
  classification: ClassificationFilter;
  search: string;
  page: number;
  pageSize: number;
  sortBy: MerchantSortField;
  sortDirection: SortDirection;
}

export const EMPTY_MERCHANT_QUERY: MerchantQueryState = {
  classification: 'all',
  search: '',
  page: 1,
  pageSize: 25,
  sortBy: 'transactionCount',
  sortDirection: 'desc'
};

function positiveInteger(params: ParamMap, name: string, fallback: number): number {
  const value = Number(params.get(name));

  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

/**
 * I criteri contenuti nell'URL.
 *
 * I valori non riconosciuti tornano ai predefiniti: un indirizzo scritto a mano
 * non deve produrre una schermata bianca né una richiesta che il backend rifiuta.
 */
export function parseMerchantQuery(params: ParamMap): MerchantQueryState {
  const classification = params.get('classification');
  const sortBy = params.get('sortBy');
  const sortDirection = params.get('sortDirection');
  const pageSize = Number(params.get('pageSize'));

  return {
    classification:
      classification === 'classified' || classification === 'unclassified'
        ? classification
        : EMPTY_MERCHANT_QUERY.classification,
    search: params.get('search')?.trim() ?? '',
    page: positiveInteger(params, 'page', EMPTY_MERCHANT_QUERY.page),
    pageSize: PAGE_SIZES.includes(pageSize as (typeof PAGE_SIZES)[number])
      ? pageSize
      : EMPTY_MERCHANT_QUERY.pageSize,
    sortBy: MERCHANT_SORT_FIELDS.includes(sortBy as MerchantSortField)
      ? (sortBy as MerchantSortField)
      : EMPTY_MERCHANT_QUERY.sortBy,
    sortDirection:
      sortDirection === 'asc' || sortDirection === 'desc'
        ? sortDirection
        : EMPTY_MERCHANT_QUERY.sortDirection
  };
}

/** `null` toglie il parametro dall'URL: i valori predefiniti non lo sporcano. */
function param(value: string | number, fallback: string | number): string | null {
  return value === fallback ? null : String(value);
}

/** I criteri come parametri di query string, per l'indirizzo e per la richiesta. */
export function toMerchantQueryParams(state: MerchantQueryState): Params {
  const empty = EMPTY_MERCHANT_QUERY;

  return {
    search: param(state.search, empty.search),
    classification: param(state.classification, empty.classification),
    sortBy: param(state.sortBy, empty.sortBy),
    sortDirection: param(state.sortDirection, empty.sortDirection),
    page: param(state.page, empty.page),
    pageSize: param(state.pageSize, empty.pageSize)
  };
}
