import { convertToParamMap } from '@angular/router';
import {
  EMPTY_QUERY,
  TransactionQueryState,
  hasFilters,
  parseTransactionQuery,
  toQueryParams
} from './transaction-query';

const parse = (params: Record<string, string | string[]>): TransactionQueryState =>
  parseTransactionQuery(convertToParamMap(params));

describe('parseTransactionQuery', () => {
  it('un URL senza parametri vale la ricerca predefinita', () => {
    expect(parse({})).toEqual(EMPTY_QUERY);
  });

  it('legge periodo, ricerca e paginazione', () => {
    expect(
      parse({ from: '2026-07-01', to: '2026-07-31', search: ' esselunga ', page: '3', pageSize: '50' })
    ).toMatchObject({
      from: '2026-07-01',
      to: '2026-07-31',
      search: 'esselunga',
      page: 3,
      pageSize: 50
    });
  });

  it('accetta elenchi separati da virgole e parametri ripetuti', () => {
    expect(parse({ types: 'EXPENSE,INCOME' }).types).toEqual(['EXPENSE', 'INCOME']);
    expect(parse({ categoryIds: ['a', 'b,c'] }).categoryIds).toEqual(['a', 'b', 'c']);
  });

  it('ignora vuoti e duplicati', () => {
    expect(parse({ merchantIds: 'a,,  ,a,b' }).merchantIds).toEqual(['a', 'b']);
  });

  it('un URL scritto a mano non rompe la pagina', () => {
    const query = parse({
      types: 'SPESA',
      classification: 'forse',
      sortBy: 'description',
      sortDirection: 'su',
      page: '-2',
      pageSize: '7'
    });

    expect(query.types).toEqual([]);
    expect(query.classification).toBe('all');
    expect(query.sortBy).toBe('bookingDate');
    expect(query.sortDirection).toBe('desc');
    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(25);
  });

  it('riconosce i due stati di classificazione', () => {
    expect(parse({ classification: 'unclassified' }).classification).toBe('unclassified');
    expect(parse({ classification: 'classified' }).classification).toBe('classified');
  });
});

describe('toQueryParams', () => {
  it('i valori predefiniti non sporcano l\'URL', () => {
    const params = toQueryParams(EMPTY_QUERY);

    expect(Object.values(params).every((value) => value === null)).toBe(true);
  });

  it('serializza gli elenchi separati da virgole', () => {
    const params = toQueryParams({
      ...EMPTY_QUERY,
      types: ['EXPENSE', 'LOAN'],
      categoryIds: ['cat-1', 'cat-2']
    });

    expect(params['types']).toBe('EXPENSE,LOAN');
    expect(params['categoryIds']).toBe('cat-1,cat-2');
  });

  it('quello che scrive viene riletto identico', () => {
    const state: TransactionQueryState = {
      from: '2026-01-01',
      to: '2026-12-31',
      search: 'amazon',
      types: ['EXPENSE'],
      categoryIds: ['cat-1'],
      merchantIds: ['m-1', 'm-2'],
      classification: 'classified',
      minAmount: '10',
      maxAmount: '99.5',
      page: 4,
      pageSize: 100,
      sortBy: 'amount',
      sortDirection: 'asc'
    };

    const params = Object.fromEntries(
      Object.entries(toQueryParams(state)).filter(([, value]) => value !== null)
    ) as Record<string, string>;

    expect(parse(params)).toEqual(state);
  });
});

describe('hasFilters', () => {
  it('la ricerca predefinita non ha filtri', () => {
    expect(hasFilters(EMPTY_QUERY)).toBe(false);
  });

  it('pagina e ordinamento non sono filtri', () => {
    expect(hasFilters({ ...EMPTY_QUERY, page: 3, sortBy: 'amount' })).toBe(false);
  });

  it('qualsiasi criterio conta come filtro', () => {
    expect(hasFilters({ ...EMPTY_QUERY, search: 'x' })).toBe(true);
    expect(hasFilters({ ...EMPTY_QUERY, from: '2026-01-01' })).toBe(true);
    expect(hasFilters({ ...EMPTY_QUERY, classification: 'unclassified' })).toBe(true);
    expect(hasFilters({ ...EMPTY_QUERY, minAmount: '10' })).toBe(true);
  });
});
