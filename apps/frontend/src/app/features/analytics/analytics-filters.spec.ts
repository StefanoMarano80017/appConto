import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsFilters } from './analytics-filters';
import { AnalyticsStore } from './analytics.store';

/**
 * L'intestazione unificata del pannello (§1 del restyle C): badge del
 * conteggio e tasto "Azzera" compaiono solo quando c'è almeno un filtro
 * attivo, e il tasto azzera davvero i criteri (non il periodo, che vive in
 * un altro stato — v. il commento su `activeCount` nel componente).
 */
describe('AnalyticsFilters', () => {
  let fixture: ComponentFixture<AnalyticsFilters>;
  let store: AnalyticsStore;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const badge = (): HTMLElement | null => host().querySelector('app-badge[titleAdornment]');
  const reset = (): HTMLButtonElement | null => host().querySelector('button[panelActions]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AnalyticsFilters] }).compileComponents();

    store = TestBed.inject(AnalyticsStore);
    store.resetFilters();

    fixture = TestBed.createComponent(AnalyticsFilters);
    fixture.componentRef.setInput('categories', [{ id: 'cat-1', name: 'Alimentari', color: null }]);
    fixture.componentRef.setInput('merchants', []);
  });

  it('senza filtri attivi non mostra né il badge né il tasto azzera', async () => {
    await fixture.whenStable();

    expect(badge()).toBeNull();
    expect(reset()).toBeNull();
  });

  it('con un filtro attivo mostra il badge al singolare e il tasto azzera', async () => {
    store.toggleCategory('cat-1');
    await fixture.whenStable();

    expect(badge()?.textContent?.trim()).toBe('1 attivo');
    expect(reset()).not.toBeNull();
  });

  it('con più filtri attivi il badge è al plurale', async () => {
    store.toggleCategory('cat-1');
    store.toggleType('EXPENSE');
    await fixture.whenStable();

    expect(badge()?.textContent?.trim()).toBe('2 attivi');
  });

  it('il tasto azzera riporta i criteri a zero, senza far sparire l\'intestazione', async () => {
    store.toggleCategory('cat-1');
    await fixture.whenStable();

    reset()?.click();
    await fixture.whenStable();

    expect(store.filters().categoryIds).toEqual([]);
    expect(badge()).toBeNull();
    expect(reset()).toBeNull();
    expect(host().querySelector('app-section-header h2')?.textContent?.trim()).toBe('Filtri');
  });
});
