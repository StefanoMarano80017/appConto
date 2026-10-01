import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api';
import { EMPTY_QUERY, TransactionQueryState } from '../transactions/transaction-query';
import { Transaction, TransactionPage } from '../transactions/transaction.model';
import { AnalyticsSelectionValue } from './analytics-selection';
import { AnalyticsTransactions } from './analytics-transactions';

const categorySelection: AnalyticsSelectionValue = {
  kind: 'category',
  categoryId: 'cat-1',
  name: 'Alimentari'
};

const categoryQuery: TransactionQueryState = {
  ...EMPTY_QUERY,
  categoryIds: ['cat-1'],
  types: ['EXPENSE']
};

/** Un'altra selezione, per i cambi di selezione. */
const otherSelection: AnalyticsSelectionValue = {
  kind: 'category',
  categoryId: 'cat-2',
  name: 'Casa'
};

const otherQuery: TransactionQueryState = {
  ...EMPTY_QUERY,
  categoryIds: ['cat-2'],
  types: ['EXPENSE']
};

/** Senza selezione: il periodo dell'analisi, coi suoi filtri. */
const periodQuery: TransactionQueryState = {
  ...EMPTY_QUERY,
  from: '2026-01-01',
  to: '2026-12-31'
};

const transaction = (id: string, description = 'ESSELUNGA'): Transaction => ({
  id,
  bookingDate: '2026-07-10',
  description,
  amount: -30,
  type: 'EXPENSE',
  merchant: null
});

const page = (count: number, total: number, description = 'ESSELUNGA'): TransactionPage => ({
  items: Array.from({ length: count }, (_, i) => transaction(`t-${i}`, description)),
  pagination: { page: 1, pageSize: 25, total, totalPages: Math.max(1, Math.ceil(total / 25)) }
});

describe('AnalyticsTransactions', () => {
  let fixture: ComponentFixture<AnalyticsTransactions>;
  let http: HttpTestingController;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => host().textContent ?? '';
  const title = (): HTMLElement | null => host().querySelector('h2');
  const showAll = (): HTMLButtonElement | undefined =>
    Array.from(host().querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Mostra tutto'
    );

  // Non `whenStable()`: aspetterebbe la risposta, che qui la dà il test.
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const render = async (
    selection: AnalyticsSelectionValue | null = categorySelection,
    query: TransactionQueryState = categoryQuery
  ): Promise<void> => {
    fixture = TestBed.createComponent(AnalyticsTransactions);
    fixture.componentRef.setInput('selection', selection);
    fixture.componentRef.setInput('query', query);
    await settle();
  };

  const pending = (): TestRequest[] =>
    http.match((request) => request.url === `${API_BASE_URL}/transactions`);

  const respond = async (data: TransactionPage): Promise<void> => {
    const [request] = pending();
    expect(request).toBeDefined();
    request!.flush(data);
    await settle();
  };

  // Chiude i conti con le richieste ancora attese (quelle annullate non contano).
  const finish = async (): Promise<void> => {
    for (const request of pending().filter((candidate) => !candidate.cancelled)) {
      request.flush(page(0, 0));
    }
    await settle();
  };

  beforeEach(async () => {
    // jsdom non implementa scrollIntoView: lo stub serve a verificare che nessuno lo chiami.
    Element.prototype.scrollIntoView = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AnalyticsTransactions],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Nessuna richiesta deve restare aperta: ogni test risponde a quelle ancora attese.
    http.verify();
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it('chiede la prima pagina della selezione, per data decrescente', async () => {
    await render();

    const request = http.expectOne((candidate) => candidate.url === `${API_BASE_URL}/transactions`);
    const params = request.request.params;

    expect(params.get('categoryIds')).toBe('cat-1');
    expect(params.get('types')).toBe('EXPENSE');
    // 25 è il predefinito, e bookingDate/desc l'ordinamento predefinito: non compaiono.
    expect(params.has('pageSize')).toBe(false);
    expect(Number(params.get('page') ?? 1)).toBeLessThanOrEqual(1);
    expect(params.get('sortBy') ?? 'bookingDate').toBe('bookingDate');
    expect(params.get('sortDirection') ?? 'desc').toBe('desc');
  });

  it('il titolo dice cosa si sta guardando', async () => {
    const cases: Array<[AnalyticsSelectionValue, string]> = [
      [
        {
          kind: 'period',
          granularity: 'month',
          period: '2026-07',
          range: { from: '2026-07-01', to: '2026-07-31' },
          label: 'Luglio 2026'
        },
        'Luglio 2026'
      ],
      [{ kind: 'category', categoryId: null, name: 'Senza categoria' }, 'Da classificare'],
      [categorySelection, 'Alimentari']
    ];

    for (const [selection, label] of cases) {
      await render(selection);
      expect(title()?.textContent?.trim()).toBe(`Transazioni · ${label}`);
      await respond(page(0, 0));
      fixture.destroy();
    }
  });

  it('senza selezione il titolo dice che sono le transazioni del periodo', async () => {
    await render(null, periodQuery);

    expect(title()?.textContent?.trim()).toBe('Transazioni del periodo');
    const [request] = pending();
    expect(request!.request.params.get('from')).toBe('2026-01-01');
    expect(request!.request.params.get('to')).toBe('2026-12-31');
    request!.flush(page(25, 312));
    await settle();

    // Il resto non cambia: stessa anteprima, stesso collegamento.
    expect(text()).toContain('Mostrate 25 di 312');
    expect(host().querySelector('a[href*="/transactions"]')?.getAttribute('href')).toContain(
      'from=2026-01-01'
    );
  });

  it('un’anteprima parziale lo dichiara e nasconde il totale', async () => {
    await render();
    await respond(page(25, 312));

    expect(text()).toContain('Mostrate 25 di 312');
    expect(host().querySelectorAll('app-transactions-table tbody tr')).toHaveLength(25);
    expect(host().querySelector('app-transactions-table tfoot')).toBeNull();
  });

  it('quando ci sono tutte, conta e mostra il totale', async () => {
    await render();
    await respond(page(3, 3));

    expect(text()).toContain('3 transazioni');
    expect(text()).not.toContain('Mostrate');
    expect(host().querySelector('app-transactions-table tfoot')).not.toBeNull();

    fixture.destroy();
    await render();
    await respond(page(1, 1));

    expect(text()).toContain('1 transazione');
    expect(text()).not.toContain('1 transazioni');
  });

  it('la tabella è in sola lettura', async () => {
    await render();
    await respond(page(3, 3));

    const table = host().querySelector('app-transactions-table');
    expect(table).not.toBeNull();
    expect(table!.querySelector('select')).toBeNull();
    expect(table!.querySelector('input[type=checkbox]')).toBeNull();
  });

  it('il link apre la stessa selezione in Movimenti', async () => {
    await render();
    await respond(page(25, 312));

    const link = host().querySelector<HTMLAnchorElement>('a[href*="/transactions"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('Apri in Movimenti →');
    expect(link!.getAttribute('href')).toContain('categoryIds=cat-1');
  });

  it('mostra il caricamento, poi l’errore con riprova', async () => {
    await render();
    expect(text()).toContain('Caricamento in corso…');

    pending()[0].flush('guasto', { status: 500, statusText: 'Server Error' });
    await settle();

    const retry = host().querySelector<HTMLButtonElement>('app-error-retry button');
    expect(retry).not.toBeNull();

    retry!.click();
    await settle();

    expect(pending()).toHaveLength(1);
  });

  it('senza righe lo dice', async () => {
    await render();
    await respond(page(0, 0));

    expect(text()).toContain('Nessuna transazione per questa selezione.');
    expect(host().querySelector('app-transactions-table')).toBeNull();
  });

  it('«Mostra tutto» c’è solo con una selezione, ed emette cleared', async () => {
    await render(null, periodQuery);
    // Senza selezione non c'è niente da togliere: nessun pulsante, né la × di prima.
    expect(showAll()).toBeUndefined();
    expect(host().querySelector('button[aria-label="Chiudi dettaglio"]')).toBeNull();
    await finish();
    fixture.destroy();

    await render();
    let cleared = 0;
    fixture.componentInstance.cleared.subscribe(() => cleared++);

    expect(showAll()).toBeDefined();
    expect(host().querySelector('button[aria-label="Chiudi dettaglio"]')).toBeNull();
    showAll()!.click();

    expect(cleared).toBe(1);
    await finish();
  });

  it('cambiando selezione in volo, vince l’ultima', async () => {
    await render();
    const [first] = pending();

    fixture.componentRef.setInput('selection', otherSelection);
    fixture.componentRef.setInput('query', otherQuery);
    await settle();

    const [second] = pending().filter((request) => request !== first);
    expect(second.request.params.get('categoryIds')).toBe('cat-2');
    second.flush(page(2, 2, 'CARREFOUR'));
    await settle();

    // La risposta vecchia, se mai arrivasse, non deve più toccare la vista.
    if (!first.cancelled) {
      first.flush(page(4, 4, 'ESSELUNGA'));
      await settle();
    }
    expect(first.cancelled).toBe(true);

    expect(title()?.textContent?.trim()).toBe('Transazioni · Casa');
    const rows = host().querySelectorAll('app-transactions-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('CARREFOUR');
  });

  it('ricaricando la stessa selezione, le righe di prima restano attenuate finché non arrivano le nuove', async () => {
    await render();
    await respond(page(2, 2, 'ESSELUNGA'));

    fixture.componentRef.setInput('query', { ...categoryQuery, search: 'bio' });
    await settle();

    const content = host().querySelector('.content');
    expect(content?.classList.contains('stale')).toBe(true);
    expect(content?.getAttribute('aria-busy')).toBe('true');
    expect(host().querySelectorAll('app-transactions-table tbody tr')).toHaveLength(2);

    await respond(page(3, 3, 'BIO'));

    expect(host().querySelector('.content.stale')).toBeNull();
    expect(host().querySelector('.content')?.getAttribute('aria-busy')).toBe('false');
    const rows = host().querySelectorAll('app-transactions-table tbody tr');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('BIO');
  });

  it('senza selezione, un cambio di filtri tiene attenuate le righe di prima', async () => {
    // Nessuna selezione prima e dopo: è la stessa "selezione" (null), quindi
    // le righe a schermo appartengono ancora a ciò che si sta guardando.
    await render(null, periodQuery);
    await respond(page(2, 2, 'ESSELUNGA'));

    fixture.componentRef.setInput('query', { ...periodQuery, types: ['INCOME'] });
    await settle();

    expect(host().querySelector('.content')?.classList.contains('stale')).toBe(true);
    expect(text()).not.toContain('Caricamento in corso…');
    expect(host().querySelectorAll('app-transactions-table tbody tr')).toHaveLength(2);

    await respond(page(1, 1, 'STIPENDIO'));

    expect(host().querySelector('.content.stale')).toBeNull();
    expect(host().querySelectorAll('app-transactions-table tbody tr')).toHaveLength(1);
  });

  it('cambiando selezione, le righe della precedente spariscono fino alla nuova risposta', async () => {
    await render();
    await respond(page(25, 312, 'ESSELUNGA'));

    fixture.componentRef.setInput('selection', otherSelection);
    fixture.componentRef.setInput('query', otherQuery);
    await settle();

    expect(text()).toContain('Caricamento in corso…');
    expect(text()).not.toContain('ESSELUNGA');
    expect(text()).not.toContain('Mostrate');
    expect(host().querySelector('app-transactions-table')).toBeNull();

    await respond(page(2, 2, 'CARREFOUR'));

    expect(text()).not.toContain('Caricamento in corso…');
    const rows = host().querySelectorAll('app-transactions-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('CARREFOUR');
  });

  it('togliendo la selezione, le righe dell’elemento spariscono fino a quelle del periodo', async () => {
    await render();
    await respond(page(2, 2, 'ESSELUNGA'));

    fixture.componentRef.setInput('selection', null);
    fixture.componentRef.setInput('query', periodQuery);
    await settle();

    expect(text()).toContain('Caricamento in corso…');
    expect(host().querySelector('app-transactions-table')).toBeNull();

    await respond(page(3, 3, 'CARREFOUR'));

    expect(title()?.textContent?.trim()).toBe('Transazioni del periodo');
    expect(host().querySelectorAll('app-transactions-table tbody tr')).toHaveLength(3);
  });

  it('una selezione non porta in vista il pannello e non ne sposta il focus', async () => {
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    (document.activeElement as HTMLElement | null)?.blur();
    const before = document.activeElement;

    await render(null, periodQuery);
    await finish();

    fixture.componentRef.setInput('selection', categorySelection);
    fixture.componentRef.setInput('query', categoryQuery);
    await settle();
    fixture.componentRef.setInput('selection', otherSelection);
    fixture.componentRef.setInput('query', otherQuery);
    await settle();

    expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(before);
    // Il titolo non è più un bersaglio del focus da programma.
    expect(title()?.hasAttribute('tabindex')).toBe(false);
    await finish();
  });
});
