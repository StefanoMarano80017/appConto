import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from '../../shared/errors.js';
import { parseMerchantQuery } from './merchant-query.js';

const vuoto = {
  search: undefined,
  classification: undefined,
  page: undefined,
  pageSize: undefined,
  sortBy: undefined,
  sortDirection: undefined,
};

describe('parseMerchantQuery', () => {
  it('un input vuoto vale DEFAULT_MERCHANT_QUERY', () => {
    assert.deepEqual(parseMerchantQuery({}), {
      search: null,
      classification: 'all',
      page: 1,
      pageSize: 25,
      sortBy: 'transactionCount',
      sortDirection: 'desc',
    });
  });

  it('legge tutti i parametri', () => {
    assert.deepEqual(
      parseMerchantQuery({
        search: ' bar ',
        classification: 'unclassified',
        page: '3',
        pageSize: '50',
        sortBy: 'name',
        sortDirection: 'asc',
      }),
      {
        search: 'bar',
        classification: 'unclassified',
        page: 3,
        pageSize: 50,
        sortBy: 'name',
        sortDirection: 'asc',
      },
    );
  });

  it('una ricerca di soli spazi vale null', () => {
    assert.equal(parseMerchantQuery({ ...vuoto, search: '   ' }).search, null);
  });

  it('rifiuta valori non validi', () => {
    const invalidi = [
      { sortBy: 'foo' },
      { sortDirection: 'up' },
      { classification: 'x' },
      { pageSize: '30' },
      { page: '0' },
      { page: 'abc' },
    ];

    for (const invalido of invalidi) {
      assert.throws(() => parseMerchantQuery({ ...vuoto, ...invalido }), ValidationError);
    }
  });
});
