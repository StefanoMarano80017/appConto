import { ValidationError } from '../../shared/errors.js';
import { toSingle, type QueryParam } from '../../shared/http/query-params.js';
import {
  CLASSIFICATION_FILTERS,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  type ClassificationFilter,
  type SortDirection,
} from '../transactions/index.js';

/**
 * Criteri di ricerca dei merchant: contratto di dominio, senza Express né SQL.
 * Il repository lo traduce in una query.
 */

/** I soli campi su cui è consentito ordinare: la query string non decide. */
export const MERCHANT_SORT_FIELDS = [
  'name',
  'category',
  'transactionCount',
  'totalSpent',
  'lastTransactionDate',
] as const;

export type MerchantSortField = (typeof MERCHANT_SORT_FIELDS)[number];

export interface MerchantQuery {
  /** Testo cercato nel nome del merchant. `null` = nessun vincolo. */
  search: string | null;
  classification: ClassificationFilter;
  page: number;
  pageSize: number;
  sortBy: MerchantSortField;
  sortDirection: SortDirection;
}

/** Nessun filtro: la prima pagina, dal merchant con più transazioni. */
export const DEFAULT_MERCHANT_QUERY: MerchantQuery = {
  search: null,
  classification: 'all',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sortBy: 'transactionCount',
  sortDirection: 'desc',
};

export interface MerchantQueryInput {
  search?: QueryParam;
  classification?: QueryParam;
  page?: QueryParam;
  pageSize?: QueryParam;
  sortBy?: QueryParam;
  sortDirection?: QueryParam;
}

function toPositiveInteger(value: QueryParam, name: string, fallback: number): number {
  const raw = toSingle(value);
  if (raw === null) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ValidationError(`Il parametro "${name}" deve essere un intero positivo.`);
  }

  return parsed;
}

export function parseMerchantQuery(input: MerchantQueryInput): MerchantQuery {
  const classification = toSingle(input.classification) ?? DEFAULT_MERCHANT_QUERY.classification;
  if (!CLASSIFICATION_FILTERS.includes(classification as ClassificationFilter)) {
    throw new ValidationError(`Stato di classificazione "${classification}" non riconosciuto.`);
  }

  const sortBy = toSingle(input.sortBy) ?? DEFAULT_MERCHANT_QUERY.sortBy;
  if (!MERCHANT_SORT_FIELDS.includes(sortBy as MerchantSortField)) {
    throw new ValidationError(
      `Ordinamento "${sortBy}" non consentito: usare uno fra ${MERCHANT_SORT_FIELDS.join(', ')}.`,
    );
  }

  const sortDirection = toSingle(input.sortDirection) ?? DEFAULT_MERCHANT_QUERY.sortDirection;
  if (sortDirection !== 'asc' && sortDirection !== 'desc') {
    throw new ValidationError('La direzione di ordinamento deve essere "asc" oppure "desc".');
  }

  const pageSize = toPositiveInteger(input.pageSize, 'pageSize', DEFAULT_PAGE_SIZE);
  if (!PAGE_SIZES.includes(pageSize as (typeof PAGE_SIZES)[number])) {
    throw new ValidationError(`Il parametro "pageSize" deve valere ${PAGE_SIZES.join(', ')}.`);
  }

  const search = toSingle(input.search)?.trim() ?? '';

  return {
    search: search.length === 0 ? null : search,
    classification: classification as ClassificationFilter,
    page: toPositiveInteger(input.page, 'page', 1),
    pageSize,
    sortBy: sortBy as MerchantSortField,
    sortDirection,
  };
}
