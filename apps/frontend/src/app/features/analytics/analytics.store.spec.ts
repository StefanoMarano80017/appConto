import { TestBed } from '@angular/core/testing';
import { AnalyticsStore } from './analytics.store';

describe('AnalyticsStore', () => {
  let store: AnalyticsStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(AnalyticsStore);
  });

  it('parte dall\'anno corrente, senza filtri', () => {
    const year = new Date().getFullYear();

    expect(store.preset()).toBe('this-year');
    expect(store.dateRange()).toEqual({ from: `${year}-01-01`, to: `${year}-12-31` });
    expect(store.hasFilters()).toBe(false);
    expect(store.query().types).toEqual([]);
  });

  it('un periodo rapido sostituisce quello precedente', () => {
    store.selectPreset('all');

    expect(store.dateRange()).toEqual({ from: null, to: null });
    expect(store.selectedPeriodLabel()).toBe('Tutto');
  });

  it('un periodo personalizzato conserva entrambe le date', () => {
    store.setCustomRange('2026-01-01', '2026-07-31');

    expect(store.preset()).toBe('custom');
    expect(store.query().from).toBe('2026-01-01');
    expect(store.selectedPeriodLabel()).toBe('01/01/2026 → 31/07/2026');
  });

  it('le selezioni multiple aggiungono e tolgono', () => {
    store.toggleType('EXPENSE');
    store.toggleType('INCOME');
    store.toggleType('EXPENSE');

    expect(store.query().types).toEqual(['INCOME']);
  });

  it('combina criteri di natura diversa', () => {
    store.toggleType('EXPENSE');
    store.toggleCategory('cat-1');
    store.toggleMerchant('m-1');
    store.setClassification('unclassified');

    expect(store.query()).toEqual({
      from: store.dateRange().from,
      to: store.dateRange().to,
      types: ['EXPENSE'],
      categoryIds: ['cat-1'],
      merchantIds: ['m-1'],
      classification: 'unclassified',
      granularity: 'week'
    });
    expect(store.hasFilters()).toBe(true);
  });

  it('il passo parte dalla settimana e non è un filtro', () => {
    expect(store.granularity()).toBe('week');
    expect(store.hasFilters()).toBe(false);

    store.setGranularity('month');

    expect(store.query().granularity).toBe('month');
    expect(store.hasFilters()).toBe(false);
  });

  it('il reset dei filtri non cambia il passo', () => {
    store.setGranularity('day');
    store.toggleType('EXPENSE');

    store.resetFilters();

    expect(store.granularity()).toBe('day');
  });

  it('il reset azzera i filtri ma non il periodo', () => {
    store.setCustomRange('2026-03-01', '2026-03-31');
    store.toggleCategory('cat-1');
    store.setClassification('classified');

    store.resetFilters();

    expect(store.hasFilters()).toBe(false);
    expect(store.query().categoryIds).toEqual([]);
    expect(store.query().classification).toBe('all');
    expect(store.dateRange()).toEqual({ from: '2026-03-01', to: '2026-03-31' });
  });
});
