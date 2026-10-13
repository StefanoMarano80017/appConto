import { convertToParamMap } from '@angular/router';
import { merchantsRequest } from './merchants.api';
import {
  EMPTY_MERCHANT_QUERY,
  FIRST_SORT_DIRECTION,
  MerchantQueryState,
  parseMerchantQuery,
  toMerchantQueryParams
} from './merchant-query';

const parse = (params: Record<string, string | string[]>): MerchantQueryState =>
  parseMerchantQuery(convertToParamMap(params));

describe('parseMerchantQuery', () => {
  it('un URL senza parametri vale la ricerca predefinita', () => {
    expect(parse({})).toEqual(EMPTY_MERCHANT_QUERY);
    expect(EMPTY_MERCHANT_QUERY).toEqual({
      classification: 'all',
      search: '',
      page: 1,
      pageSize: 25,
      sortBy: 'transactionCount',
      sortDirection: 'desc'
    });
  });

  it('legge tutti i parametri', () => {
    expect(
      parse({
        classification: 'unclassified',
        search: ' coop ',
        page: '3',
        pageSize: '50',
        sortBy: 'name',
        sortDirection: 'asc'
      })
    ).toEqual({
      classification: 'unclassified',
      search: 'coop',
      page: 3,
      pageSize: 50,
      sortBy: 'name',
      sortDirection: 'asc'
    });
  });

  it('valori non riconosciuti tornano ai predefiniti', () => {
    expect(
      parse({ sortBy: 'foo', sortDirection: 'up', classification: 'x', pageSize: '7', page: '-1' })
    ).toEqual(EMPTY_MERCHANT_QUERY);
  });
});

describe('toMerchantQueryParams', () => {
  it("i valori predefiniti non finiscono nell'URL", () => {
    const values = Object.values(toMerchantQueryParams(EMPTY_MERCHANT_QUERY));

    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => value === null)).toBe(true);
  });
});

describe('FIRST_SORT_DIRECTION', () => {
  it('testi in crescente, numeri e date in decrescente', () => {
    expect(FIRST_SORT_DIRECTION).toEqual({
      name: 'asc',
      category: 'asc',
      transactionCount: 'desc',
      totalSpent: 'desc',
      lastTransactionDate: 'desc'
    });
  });
});

describe('merchantsRequest', () => {
  it('porta solo i parametri non predefiniti', () => {
    const request = merchantsRequest({ ...EMPTY_MERCHANT_QUERY, sortBy: 'name', page: 2 });

    expect(request.url).toMatch(/\/merchants$/);
    expect(request.params?.toString()).toBe('sortBy=name&page=2');
  });
});
