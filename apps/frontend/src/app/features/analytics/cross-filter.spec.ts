import { crossFilterQuery, needsCrossFilter } from './cross-filter';
import { AnalyticsQueryState } from './analytics.store';

const query = (overrides: Partial<AnalyticsQueryState> = {}): AnalyticsQueryState => ({
  from: '2026-01-01',
  to: '2026-12-31',
  types: ['EXPENSE'],
  categoryIds: ['cat-1', 'cat-2'],
  merchantIds: ['m-1'],
  classification: 'unclassified',
  granularity: 'week',
  ...overrides
});

describe('crossFilterQuery', () => {
  it('per le categorie toglie categorie e classificazione, e nient’altro', () => {
    expect(crossFilterQuery(query(), 'category')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
      types: ['EXPENSE'],
      categoryIds: [],
      merchantIds: ['m-1'],
      classification: 'all',
      granularity: 'week'
    });
  });

  it('per i merchant toglie solo i merchant', () => {
    expect(crossFilterQuery(query(), 'merchant')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
      types: ['EXPENSE'],
      categoryIds: ['cat-1', 'cat-2'],
      merchantIds: [],
      classification: 'unclassified',
      granularity: 'week'
    });
  });

  it('non modifica la query ricevuta', () => {
    const original = query();
    crossFilterQuery(original, 'category');
    crossFilterQuery(original, 'merchant');

    expect(original).toEqual(query());
  });
});

describe('needsCrossFilter', () => {
  const none = query({ categoryIds: [], merchantIds: [], classification: 'all' });

  it('senza filtri della propria dimensione basta la richiesta principale', () => {
    expect(needsCrossFilter(none, 'category')).toBe(false);
    expect(needsCrossFilter(none, 'merchant')).toBe(false);
  });

  it('una categoria filtrata chiede la richiesta a parte solo per le categorie', () => {
    const filtered = { ...none, categoryIds: ['cat-1'] };

    expect(needsCrossFilter(filtered, 'category')).toBe(true);
    expect(needsCrossFilter(filtered, 'merchant')).toBe(false);
  });

  it('la classificazione appartiene alla dimensione delle categorie', () => {
    const filtered = { ...none, classification: 'unclassified' as const };

    expect(needsCrossFilter(filtered, 'category')).toBe(true);
    expect(needsCrossFilter(filtered, 'merchant')).toBe(false);
  });

  it('un merchant filtrato chiede la richiesta a parte solo per i merchant', () => {
    const filtered = { ...none, merchantIds: ['m-1'] };

    expect(needsCrossFilter(filtered, 'merchant')).toBe(true);
    expect(needsCrossFilter(filtered, 'category')).toBe(false);
  });
});
