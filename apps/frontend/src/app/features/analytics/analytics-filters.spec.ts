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

  it('il gruppo Periodo mostra l\'intervallo di date risolto', async () => {
    await fixture.whenStable();

    // Preset iniziale dello store: 'this-year' (analytics.store.ts). L'etichetta
    // attesa è quella per esteso di selectedPeriodLabel(), non l'abbreviazione
    // '12M' dei segmenti di ChoiceGroup: verifica il contenuto reso, non solo
    // che il selettore '.selected' esista.
    expect(host().querySelector('.selected')?.textContent?.trim()).toBe('Quest\'anno');
  });

  it('tronca il nome merchant visibile conservando nome completo e nome accessibile', async () => {
    const label = 'MERCANTE CON UNA DESCRIZIONE MOLTO LUNGA PER ESSERE TRONCATA';
    fixture.componentRef.setInput('merchants', [
      {
        id: 'merchant-long',
        name: label,
        displayName: null,
        label,
        normalizedName: label.toLowerCase(),
        category: null,
        transactionCount: 0,
        totalSpent: 0,
        lastTransactionDate: null,
      },
    ]);
    await fixture.whenStable();

    const visibleLabel = host().querySelector<HTMLElement>('app-toggle-list-group .label');
    const checkbox = host().querySelector<HTMLInputElement>(
      'app-toggle-list-group input[type="checkbox"]',
    );

    expect(visibleLabel?.textContent).toBe(`${Array.from(label).slice(0, 22).join('')}...`);
    expect(visibleLabel?.getAttribute('title')).toBe(label);
    expect(checkbox?.getAttribute('aria-label')).toBe(label);
  });

  it('la ricerca merchant filtra tutte le opzioni prima di applicare il limite visibile', async () => {
    const merchants = Array.from({ length: 8 }, (_, index) => {
      const label = `Merchant ${index + 1}`;
      return {
        id: `merchant-${index + 1}`,
        name: label,
        displayName: null,
        label,
        normalizedName: label.toLowerCase(),
        category: null,
        transactionCount: 0,
        totalSpent: 0,
        lastTransactionDate: null,
      };
    });
    const lastMerchant = {
      id: 'merchant-last',
      name: 'Merchant da cercare',
      displayName: null,
      label: 'Merchant da cercare',
      normalizedName: 'merchant da cercare',
      category: null,
      transactionCount: 0,
      totalSpent: 0,
      lastTransactionDate: null,
    };
    fixture.componentRef.setInput('merchants', [...merchants, lastMerchant]);
    await fixture.whenStable();

    expect(
      host().querySelector('app-toggle-list-group app-search-input .search.pill'),
    ).not.toBeNull();

    const search = host().querySelector<HTMLInputElement>(
      'app-toggle-list-group input[type="search"]',
    );
    expect(host().querySelectorAll('app-toggle-list-group .option').length).toBe(8);

    if (search === null) {
      throw new Error('campo di ricerca merchant non trovato');
    }
    search.value = 'cercare';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    expect(
      [...host().querySelectorAll('app-toggle-list-group .option .label')].map((label) =>
        label.textContent?.trim(),
      ),
    ).toEqual(['Merchant da cercare']);
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

  describe('granularità automatica col periodo', () => {
    const preset = async (title: string): Promise<void> => {
      host().querySelector<HTMLButtonElement>(`app-period-filter button[title="${title}"]`)!.click();
      await fixture.whenStable();
    };
    const dateInput = async (index: number, value: string): Promise<void> => {
      const input = host().querySelectorAll<HTMLInputElement>('app-period-filter input[type="date"]')[index];
      input.value = value;
      input.dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };

    beforeEach(async () => {
      await fixture.whenStable();
    });


    it('1M passa ai giorni', async () => {
      store.setGranularity('month');
      await preset('Questo mese');
      expect(store.granularity()).toBe('day');
    });

    it('3M passa alle settimane', async () => {
      store.setGranularity('month');
      await preset('Ultimi 3 mesi');
      expect(store.granularity()).toBe('week');
    });

    it('6M passa alle settimane', async () => {
      store.setGranularity('month');
      await preset('Ultimi 6 mesi');
      expect(store.granularity()).toBe('week');
    });

    it('12M passa ai mesi', async () => {
      await preset('Questo mese');
      await preset("Quest'anno");
      expect(store.granularity()).toBe('month');
    });

    it('Tutto passa ai mesi', async () => {
      store.setGranularity('day');
      await preset('Tutto');
      expect(store.granularity()).toBe('month');
    });

    it('modificare Dal e Al su 10 giorni passa ai giorni', async () => {
      store.setGranularity('month');
      await dateInput(0, '2026-03-01');
      await dateInput(1, '2026-03-10');
      expect(store.dateRange()).toEqual({ from: '2026-03-01', to: '2026-03-10' });
      expect(store.granularity()).toBe('day');
    });
  });
});
