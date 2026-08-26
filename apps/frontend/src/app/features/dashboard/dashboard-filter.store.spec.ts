import { TestBed } from '@angular/core/testing';
import { currentMonth } from '../../core/format';
import { DashboardFilterStore } from './dashboard-filter.store';

describe('DashboardFilterStore', () => {
  let store: DashboardFilterStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(DashboardFilterStore);
  });

  it('parte dal mese corrente e senza filtri', () => {
    expect(store.month()).toBe(currentMonth());
    expect(store.filters()).toEqual({
      month: currentMonth(),
      type: null,
      categoryId: null,
      merchantId: null
    });
    expect(store.activeCount()).toBe(0);
  });

  it('espone un solo mese, condiviso da tutte le sezioni', () => {
    store.setMonth('2026-07');

    expect(store.month()).toBe('2026-07');
    expect(store.filters().month).toBe('2026-07');
  });

  it('conserva i filtri quando cambia il mese', () => {
    store.setCategory('cat-1');
    store.setMonth('2026-05');

    expect(store.filters()).toEqual({
      month: '2026-05',
      type: null,
      categoryId: 'cat-1',
      merchantId: null
    });
  });

  it('conta i filtri attivi, escluso il mese', () => {
    expect(store.activeCount()).toBe(0);

    store.setType('WITHDRAWAL');
    store.setCategory('cat-1');
    store.setMerchant('merc-1');

    expect(store.activeCount()).toBe(3);
  });

  it('azzera i filtri mantenendo il mese osservato', () => {
    store.setMonth('2026-07');
    store.setType('EXPENSE');
    store.setCategory('cat-1');
    store.setMerchant('merc-1');

    store.clearFilters();

    expect(store.filters()).toEqual({
      month: '2026-07',
      type: null,
      categoryId: null,
      merchantId: null
    });
  });

  it('rimuove un singolo filtro passando null', () => {
    store.setCategory('cat-1');
    store.setMerchant('merc-1');

    store.setCategory(null);

    expect(store.filters().categoryId).toBeNull();
    expect(store.filters().merchantId).toBe('merc-1');
  });
});
