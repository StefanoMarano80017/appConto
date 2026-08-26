import { ValidationError } from '../../shared/errors.js';
import { toSingle, type QueryParam } from '../../shared/http/query-params.js';

/**
 * Criteri di selezione dei prestiti.
 *
 * È un contratto di dominio: non conosce Express né SQL. Il repository lo
 * traduce in una query.
 */

export type LoanStatusFilter = 'open' | 'settled' | 'all';

export const LOAN_STATUS_FILTERS: readonly LoanStatusFilter[] = ['open', 'settled', 'all'];

/** I soli campi su cui è consentito ordinare: la query string non decide. */
export const LOAN_SORT_FIELDS = ['remainingAmount', 'lentAt', 'amount', 'borrower'] as const;

export type LoanSortField = (typeof LOAN_SORT_FIELDS)[number];

export type SortDirection = 'asc' | 'desc';

export interface LoanQuery {
  status: LoanStatusFilter;
  /** Nome esatto della persona. `null` = tutte. */
  borrower: string | null;
  /** Testo cercato in persona, descrizione e descrizione della transazione d'origine. */
  search: string | null;
  sortBy: LoanSortField;
  sortDirection: SortDirection;
}

/**
 * Nessun filtro, credito residuo decrescente.
 *
 * L'ordinamento predefinito risponde alla domanda della pagina — «quanto devo
 * ancora ricevere, e da chi» — e mette davanti i crediti che contano di più.
 * I prestiti chiusi hanno residuo zero, quindi scendono in fondo da sé senza
 * bisogno di escluderli.
 */
export const DEFAULT_LOAN_QUERY: LoanQuery = {
  status: 'all',
  borrower: null,
  search: null,
  sortBy: 'remainingAmount',
  sortDirection: 'desc',
};

export interface LoanQueryInput {
  status?: QueryParam;
  borrower?: QueryParam;
  search?: QueryParam;
  sortBy?: QueryParam;
  sortDirection?: QueryParam;
}

export function parseLoanQuery(input: LoanQueryInput): LoanQuery {
  const status = toSingle(input.status) ?? DEFAULT_LOAN_QUERY.status;
  if (!LOAN_STATUS_FILTERS.includes(status as LoanStatusFilter)) {
    throw new ValidationError(
      `Stato "${status}" non riconosciuto: usare uno fra ${LOAN_STATUS_FILTERS.join(', ')}.`,
    );
  }

  const sortBy = toSingle(input.sortBy) ?? DEFAULT_LOAN_QUERY.sortBy;
  if (!LOAN_SORT_FIELDS.includes(sortBy as LoanSortField)) {
    throw new ValidationError(
      `Ordinamento "${sortBy}" non consentito: usare uno fra ${LOAN_SORT_FIELDS.join(', ')}.`,
    );
  }

  const sortDirection = toSingle(input.sortDirection) ?? DEFAULT_LOAN_QUERY.sortDirection;
  if (sortDirection !== 'asc' && sortDirection !== 'desc') {
    throw new ValidationError('La direzione di ordinamento deve essere "asc" oppure "desc".');
  }

  return {
    status: status as LoanStatusFilter,
    borrower: toSingle(input.borrower),
    search: toSingle(input.search),
    sortBy: sortBy as LoanSortField,
    sortDirection,
  };
}
