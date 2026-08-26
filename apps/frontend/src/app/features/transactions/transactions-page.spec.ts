import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { API_BASE_URL } from '../../core/api';
import { TransactionPage } from './transaction.model';
import { TransactionsPage } from './transactions-page';

const transaction = (id: string, description: string, amount: number) => ({
  id,
  bookingDate: '2026-07-10',
  description,
  amount,
  type: 'EXPENSE' as const,
  merchant: {
    id: `m-${id}`,
    name: description,
    displayName: null,
    label: description,
    normalizedName: description.toLowerCase(),
    category: { id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' }
  }
});

const page = (overrides: Partial<TransactionPage> = {}): TransactionPage => ({
  items: [transaction('1', 'ESSELUNGA', -300), transaction('2', 'CARREFOUR', -200)],
  pagination: { page: 1, pageSize: 25, total: 279, totalPages: 12 },
  ...overrides
});

const empty = (): TransactionPage => ({
  items: [],
  pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 }
});

describe('TransactionsPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const text = (): string =>
    (harness.routeNativeElement?.textContent ?? '').replace(/\./g, '');

  /** Risponde alle richieste di contorno: filtri e indice dei prestiti. */
  const flushLookups = async (): Promise<void> => {
    for (const request of http.match(`${API_BASE_URL}/categories`)) {
      request.flush([{ id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' }]);
    }
    for (const request of http.match(`${API_BASE_URL}/merchants/summary`)) {
      request.flush([]);
    }
    for (const request of http.match(`${API_BASE_URL}/loans/links`)) {
      request.flush({ links: [] });
    }
    await settle();
  };

  /** Risponde alla ricerca in corso, qualunque sia la query string. */
  const flush = async (data: TransactionPage = page()): Promise<string> => {
    const [request] = http.match((candidate) =>
      candidate.url.startsWith(`${API_BASE_URL}/transactions`)
    );
    expect(request).toBeDefined();
    const url = request!.request.urlWithParams;
    request!.flush(data);
    await settle();
    await flushLookups();

    return url;
  };

  const open = async (url: string): Promise<void> => {
    await harness.navigateByUrl(url, TransactionsPage);
    await settle();
  };

  const click = async (selector: string): Promise<void> => {
    harness.routeNativeElement?.querySelector<HTMLElement>(selector)?.click();
    await settle();
    await settle();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'transactions', component: TransactionsPage }])
      ],
      rethrowApplicationErrors: false
    });

    harness = await RouterTestingHarness.create();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  it('carica la prima pagina e mostra i movimenti', async () => {
    await open('/transactions');
    const url = await flush();

    expect(url).toBe(`${API_BASE_URL}/transactions`);
    expect(text()).toContain('ESSELUNGA');
    expect(text()).toContain('1–25 di 279 transazioni');
  });

  it('mostra lo scheletro della tabella durante il primo caricamento', async () => {
    await open('/transactions');

    expect(harness.routeNativeElement?.querySelectorAll('.skeleton .line').length).toBeGreaterThan(0);
    expect(text()).toContain('Caricamento in corso');

    await flush();
  });

  it('i criteri nell\'URL diventano la richiesta', async () => {
    await open(
      '/transactions?from=2026-07-01&to=2026-07-31&types=EXPENSE&categoryIds=cat-1&classification=classified&minAmount=10'
    );
    const url = await flush();

    expect(url).toContain('from=2026-07-01');
    expect(url).toContain('to=2026-07-31');
    expect(url).toContain('types=EXPENSE');
    expect(url).toContain('categoryIds=cat-1');
    expect(url).toContain('classification=classified');
    expect(url).toContain('minAmount=10');
  });

  it('cambiare l\'URL rifà la ricerca', async () => {
    await open('/transactions');
    await flush();

    await open('/transactions?types=LOAN');
    const url = await flush();

    expect(url).toContain('types=LOAN');
  });

  it('cambiare pagina aggiorna l\'URL', async () => {
    await open('/transactions');
    await flush();

    await click('app-transactions-pagination .page:not(.current)');
    const url = await flush(page({ pagination: { page: 2, pageSize: 25, total: 279, totalPages: 12 } }));

    expect(router.url).toContain('page=');
    expect(url).toContain('page=');
  });

  it('cambiare un filtro riporta alla prima pagina', async () => {
    await open('/transactions?page=4');
    await flush(page({ pagination: { page: 4, pageSize: 25, total: 279, totalPages: 12 } }));

    await click('app-transactions-toolbar .dropdown .options button');
    await flush();

    expect(router.url).not.toContain('page=4');
  });

  it('cambiare la dimensione della pagina aggiorna URL e richiesta', async () => {
    await open('/transactions?page=4');
    await flush(page({ pagination: { page: 4, pageSize: 25, total: 279, totalPages: 12 } }));

    const select = harness.routeNativeElement?.querySelector<HTMLSelectElement>(
      'app-transactions-pagination select'
    );
    select!.value = '50';
    select!.dispatchEvent(new Event('change'));
    await settle();
    await settle();

    const url = await flush(page({ pagination: { page: 1, pageSize: 50, total: 279, totalPages: 6 } }));

    expect(url).toContain('pageSize=50');
    expect(router.url).not.toContain('page=4');
  });

  it('ordinare per una colonna finisce nell\'URL', async () => {
    await open('/transactions');
    await flush();

    await click('app-transactions-table th .sort');
    const url = await flush();

    expect(router.url).toContain('sortDirection=asc');
    expect(url).toContain('sortDirection=asc');
  });

  it('la ricerca aggiorna l\'URL dopo una pausa', async () => {
    await open('/transactions');
    await flush();

    const input = harness.routeNativeElement?.querySelector<HTMLInputElement>(
      'app-transactions-toolbar .search input'
    );
    input!.value = 'amazon';
    input!.dispatchEvent(new Event('input'));
    await settle();

    expect(router.url).not.toContain('search');

    await new Promise((resolve) => setTimeout(resolve, 400));
    TestBed.tick();
    await settle();

    const url = await flush();
    expect(router.url).toContain('search=amazon');
    expect(url).toContain('search=amazon');
  });

  it('il reset toglie i filtri dall\'URL', async () => {
    await open('/transactions?types=EXPENSE&categoryIds=cat-1');
    await flush();

    await click('app-transactions-toolbar .clear');
    const url = await flush();

    expect(router.url).toBe('/transactions');
    expect(url).toBe(`${API_BASE_URL}/transactions`);
  });

  it('senza risultati propone di togliere i filtri', async () => {
    await open('/transactions?search=inesistente');
    await flush(empty());

    expect(text()).toContain('Nessuna transazione trovata');
    expect(text()).toContain('Prova a modificare o rimuovere uno dei filtri');
    expect(harness.routeNativeElement?.querySelector('app-transactions-table')).toBeNull();
  });

  it('un errore è leggibile e riprovabile', async () => {
    await open('/transactions');
    const [request] = http.match((candidate) =>
      candidate.url.startsWith(`${API_BASE_URL}/transactions`)
    );
    request!.flush(
      { error: 'Intervallo non valido: la data iniziale è successiva a quella finale.' },
      { status: 400, statusText: 'Bad Request' }
    );
    await settle();
    await flushLookups();

    expect(text()).toContain('Intervallo non valido');

    await click('.retry');
    await flush();

    expect(text()).toContain('ESSELUNGA');
  });

  it('correggere il tipo ricarica senza perdere filtri e pagina', async () => {
    await open('/transactions?types=EXPENSE&page=2');
    await flush(page({ pagination: { page: 2, pageSize: 25, total: 279, totalPages: 12 } }));

    const select = harness.routeNativeElement?.querySelector<HTMLSelectElement>(
      'app-transactions-table .type select'
    );
    select!.value = 'WITHDRAWAL';
    select!.dispatchEvent(new Event('change'));
    await settle();

    http.expectOne(`${API_BASE_URL}/transactions/1/type`).flush({ id: '1', type: 'WITHDRAWAL' });
    await settle();

    const url = await flush(page({ pagination: { page: 2, pageSize: 25, total: 279, totalPages: 12 } }));

    expect(router.url).toContain('page=2');
    expect(router.url).toContain('types=EXPENSE');
    expect(url).toContain('page=2');
  });

  it('cambiare la categoria del merchant ricarica la stessa pagina', async () => {
    await open('/transactions?page=2');
    await flush(page({ pagination: { page: 2, pageSize: 25, total: 279, totalPages: 12 } }));

    const select = harness.routeNativeElement?.querySelector<HTMLSelectElement>(
      'app-transactions-table .category select'
    );
    select!.value = '';
    select!.dispatchEvent(new Event('change'));
    await settle();

    http.expectOne(`${API_BASE_URL}/merchants/m-1/category`).flush({ id: 'm-1' });
    await settle();

    const url = await flush(
      page({ pagination: { page: 2, pageSize: 25, total: 279, totalPages: 12 } })
    );

    expect(router.url).toContain('page=2');
    expect(url).toContain('page=2');
  });
});
