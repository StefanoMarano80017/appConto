import { convertToParamMap } from '@angular/router';
import {
  EMPTY_LOAN_QUERY,
  LoanQueryState,
  hasLoanFilters,
  parseLoanQuery,
  toLoanQueryParams
} from './loan-query';

const parse = (params: Record<string, string | string[]>): LoanQueryState =>
  parseLoanQuery(convertToParamMap(params));

describe('parseLoanQuery', () => {
  it('un URL senza parametri vale la ricerca predefinita', () => {
    expect(parse({})).toEqual(EMPTY_LOAN_QUERY);
  });

  it('parte dal credito residuo decrescente', () => {
    expect(EMPTY_LOAN_QUERY.sortBy).toBe('remainingAmount');
    expect(EMPTY_LOAN_QUERY.sortDirection).toBe('desc');
  });

  it('legge stato, persona e ricerca', () => {
    expect(parse({ status: 'open', borrower: ' Mamma ', search: ' lego ' })).toMatchObject({
      status: 'open',
      borrower: 'Mamma',
      search: 'lego'
    });
  });

  it('un URL scritto a mano non rompe la pagina', () => {
    const query = parse({ status: 'boh', sortBy: 'colore', sortDirection: 'su' });

    expect(query.status).toBe('all');
    expect(query.sortBy).toBe('remainingAmount');
    expect(query.sortDirection).toBe('desc');
  });
});

describe('toLoanQueryParams', () => {
  it('i valori predefiniti non sporcano l\'indirizzo', () => {
    expect(toLoanQueryParams(EMPTY_LOAN_QUERY)).toEqual({
      status: null,
      borrower: null,
      search: null,
      sortBy: null,
      sortDirection: null
    });
  });

  it('leggere e riscrivere non cambia i criteri', () => {
    const state: LoanQueryState = {
      status: 'settled',
      borrower: 'Anna',
      search: 'assicurazione',
      sortBy: 'lentAt',
      sortDirection: 'asc'
    };

    const params = toLoanQueryParams(state);
    const roundTrip = parse(
      Object.fromEntries(
        Object.entries(params).filter(([, value]) => value !== null)
      ) as Record<string, string>
    );

    expect(roundTrip).toEqual(state);
  });
});

describe('hasLoanFilters', () => {
  it('l\'ordinamento non è un filtro', () => {
    expect(hasLoanFilters({ ...EMPTY_LOAN_QUERY, sortBy: 'amount' })).toBe(false);
  });

  it('stato, persona e ricerca lo sono', () => {
    expect(hasLoanFilters({ ...EMPTY_LOAN_QUERY, status: 'open' })).toBe(true);
    expect(hasLoanFilters({ ...EMPTY_LOAN_QUERY, borrower: 'Anna' })).toBe(true);
    expect(hasLoanFilters({ ...EMPTY_LOAN_QUERY, search: 'lego' })).toBe(true);
  });
});
