import { ParamMap, Params } from '@angular/router';

/**
 * Criteri di ricerca dei prestiti.
 *
 * Vivono nella query string, come quelli dell'esplorazione dei movimenti:
 * ricaricare, tornare indietro e condividere un indirizzo sono la stessa cosa.
 */

export type LoanStatusFilter = 'open' | 'settled' | 'all';

export const LOAN_STATUS_FILTERS: readonly LoanStatusFilter[] = ['all', 'open', 'settled'];

export const LOAN_STATUS_FILTER_LABELS: Record<LoanStatusFilter, string> = {
  all: 'Tutti',
  open: 'Aperti',
  settled: 'Chiusi'
};

export const LOAN_SORT_FIELDS = ['remainingAmount', 'lentAt', 'amount', 'borrower'] as const;

export type LoanSortField = (typeof LOAN_SORT_FIELDS)[number];

export type SortDirection = 'asc' | 'desc';

export interface LoanQueryState {
  status: LoanStatusFilter;
  /** Nome esatto della persona. Stringa vuota = tutte. */
  borrower: string;
  search: string;
  sortBy: LoanSortField;
  sortDirection: SortDirection;
}

/**
 * Nessun filtro, credito residuo decrescente.
 *
 * Aprendo la pagina la domanda è «quanto devo ancora ricevere, e da chi»: i
 * crediti più grandi stanno in cima, i prestiti chiusi scendono in fondo da sé.
 */
export const EMPTY_LOAN_QUERY: LoanQueryState = {
  status: 'all',
  borrower: '',
  search: '',
  sortBy: 'remainingAmount',
  sortDirection: 'desc'
};

function text(params: ParamMap, name: string): string {
  return params.get(name)?.trim() ?? '';
}

/**
 * I criteri contenuti nell'URL.
 *
 * I valori non riconosciuti vengono ignorati invece di rompere la pagina: un
 * indirizzo scritto a mano non deve produrre una schermata bianca.
 */
export function parseLoanQuery(params: ParamMap): LoanQueryState {
  const status = params.get('status');
  const sortBy = params.get('sortBy');

  return {
    status: LOAN_STATUS_FILTERS.includes(status as LoanStatusFilter)
      ? (status as LoanStatusFilter)
      : EMPTY_LOAN_QUERY.status,
    borrower: text(params, 'borrower'),
    search: text(params, 'search'),
    sortBy: LOAN_SORT_FIELDS.includes(sortBy as LoanSortField)
      ? (sortBy as LoanSortField)
      : EMPTY_LOAN_QUERY.sortBy,
    sortDirection: params.get('sortDirection') === 'asc' ? 'asc' : EMPTY_LOAN_QUERY.sortDirection
  };
}

/** `null` toglie il parametro dall'URL: i valori predefiniti non lo sporcano. */
function param<T extends string>(value: T, fallback: T): T | null {
  return value === fallback ? null : value;
}

/**
 * I criteri come parametri di query string.
 *
 * Vale sia per l'indirizzo del browser sia per la richiesta al backend: una
 * sola serializzazione, quindi non possono divergere.
 */
export function toLoanQueryParams(state: LoanQueryState): Params {
  return {
    status: param(state.status, EMPTY_LOAN_QUERY.status),
    borrower: param(state.borrower, ''),
    search: param(state.search, ''),
    sortBy: param(state.sortBy, EMPTY_LOAN_QUERY.sortBy),
    sortDirection: param(state.sortDirection, EMPTY_LOAN_QUERY.sortDirection)
  };
}

/** Se è attivo un criterio oltre all'ordinamento. */
export function hasLoanFilters(state: LoanQueryState): boolean {
  return state.status !== 'all' || state.borrower !== '' || state.search !== '';
}
