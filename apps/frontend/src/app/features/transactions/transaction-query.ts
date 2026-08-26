import { ParamMap, Params } from '@angular/router';
import { DateRange } from '../../core/period';
import { TRANSACTION_TYPES, TransactionType } from './transaction-type';

/**
 * Criteri di ricerca dei movimenti.
 *
 * Vivono nella query string: l'URL è l'unica fonte di verità, così ricaricare
 * la pagina, usare avanti/indietro del browser, condividere un indirizzo e
 * arrivare da Analytics con un filtro già applicato sono la stessa cosa.
 */

export type ClassificationFilter = 'all' | 'classified' | 'unclassified';

export const CLASSIFICATION_LABELS: Record<ClassificationFilter, string> = {
  all: 'Tutti',
  classified: 'Classificati',
  unclassified: 'Da classificare'
};

export const TRANSACTION_SORT_FIELDS = [
  'bookingDate',
  'amount',
  'merchant',
  'category',
  'type'
] as const;

export type TransactionSortField = (typeof TRANSACTION_SORT_FIELDS)[number];

export type SortDirection = 'asc' | 'desc';

export const PAGE_SIZES = [25, 50, 100] as const;

export interface TransactionQueryState extends DateRange {
  search: string;
  types: TransactionType[];
  categoryIds: string[];
  merchantIds: string[];
  classification: ClassificationFilter;
  /** Importi come li digita l'utente, in euro: la conversione è del backend. */
  minAmount: string;
  maxAmount: string;
  page: number;
  pageSize: number;
  sortBy: TransactionSortField;
  sortDirection: SortDirection;
}

export const EMPTY_QUERY: TransactionQueryState = {
  from: null,
  to: null,
  search: '',
  types: [],
  categoryIds: [],
  merchantIds: [],
  classification: 'all',
  minAmount: '',
  maxAmount: '',
  page: 1,
  pageSize: 25,
  sortBy: 'bookingDate',
  sortDirection: 'desc'
};

/** Un parametro può arrivare ripetuto o come elenco separato da virgole. */
function list(params: ParamMap, name: string): string[] {
  const values = params
    .getAll(name)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return [...new Set(values)];
}

function text(params: ParamMap, name: string): string {
  return params.get(name)?.trim() ?? '';
}

function positiveInteger(params: ParamMap, name: string, fallback: number): number {
  const value = Number(params.get(name));

  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

/**
 * I criteri contenuti nell'URL.
 *
 * I valori non riconosciuti vengono ignorati invece di rompere la pagina: un
 * indirizzo scritto a mano non deve produrre una schermata bianca. Sarà il
 * backend a rifiutare ciò che resta di davvero non valido.
 */
export function parseTransactionQuery(params: ParamMap): TransactionQueryState {
  const classification = params.get('classification');
  const sortBy = params.get('sortBy');
  const sortDirection = params.get('sortDirection');
  const pageSize = Number(params.get('pageSize'));

  return {
    from: params.get('from') || null,
    to: params.get('to') || null,
    search: text(params, 'search'),
    types: list(params, 'types').filter((type): type is TransactionType =>
      TRANSACTION_TYPES.includes(type as TransactionType)
    ),
    categoryIds: list(params, 'categoryIds'),
    merchantIds: list(params, 'merchantIds'),
    classification:
      classification === 'classified' || classification === 'unclassified'
        ? classification
        : 'all',
    minAmount: text(params, 'minAmount'),
    maxAmount: text(params, 'maxAmount'),
    page: positiveInteger(params, 'page', 1),
    pageSize: PAGE_SIZES.includes(pageSize as (typeof PAGE_SIZES)[number])
      ? pageSize
      : EMPTY_QUERY.pageSize,
    sortBy: TRANSACTION_SORT_FIELDS.includes(sortBy as TransactionSortField)
      ? (sortBy as TransactionSortField)
      : EMPTY_QUERY.sortBy,
    sortDirection: sortDirection === 'asc' ? 'asc' : EMPTY_QUERY.sortDirection
  };
}

/** `null` toglie il parametro dall'URL: i valori predefiniti non lo sporcano. */
function param(value: string, fallback: string): string | null {
  return value === fallback ? null : value;
}

/**
 * I criteri come parametri di query string.
 *
 * Vale sia per l'indirizzo del browser sia per la richiesta al backend: una
 * sola serializzazione, quindi non possono divergere.
 */
export function toQueryParams(state: TransactionQueryState): Params {
  return {
    from: state.from,
    to: state.to,
    search: param(state.search, ''),
    types: state.types.length === 0 ? null : state.types.join(','),
    categoryIds: state.categoryIds.length === 0 ? null : state.categoryIds.join(','),
    merchantIds: state.merchantIds.length === 0 ? null : state.merchantIds.join(','),
    classification: param(state.classification, 'all'),
    minAmount: param(state.minAmount, ''),
    maxAmount: param(state.maxAmount, ''),
    page: state.page === 1 ? null : String(state.page),
    pageSize: state.pageSize === EMPTY_QUERY.pageSize ? null : String(state.pageSize),
    sortBy: param(state.sortBy, EMPTY_QUERY.sortBy),
    sortDirection: param(state.sortDirection, EMPTY_QUERY.sortDirection)
  };
}

/** Quanti criteri, oltre alla pagina e all'ordinamento, sono attivi. */
export function hasFilters(state: TransactionQueryState): boolean {
  return (
    state.from !== null ||
    state.to !== null ||
    state.search !== '' ||
    state.types.length > 0 ||
    state.categoryIds.length > 0 ||
    state.merchantIds.length > 0 ||
    state.classification !== 'all' ||
    state.minAmount !== '' ||
    state.maxAmount !== ''
  );
}
