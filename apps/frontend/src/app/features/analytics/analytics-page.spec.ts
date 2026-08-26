import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api';
import { AnalyticsPage } from './analytics-page';
import { Analytics } from './analytics.model';
import { AnalyticsStore } from './analytics.store';

/** Sta al posto dell'esplorazione: qui interessa solo dove porta il collegamento. */
@Component({ selector: 'app-stub-transactions', template: '' })
class StubTransactionsPage {}

const analytics = (overrides: Partial<Analytics> = {}): Analytics => ({
  period: {
    from: '2026-01-01',
    to: '2026-12-31',
    firstTransactionDate: '2026-07-10',
    lastTransactionDate: '2026-07-11'
  },
  query: {
    from: '2026-01-01',
    to: '2026-12-31',
    types: [],
    categoryIds: [],
    merchantIds: [],
    classification: 'all',
    granularity: 'week'
  },
  overview: {
    income: 2000,
    expenses: 500,
    balance: 1500,
    withdrawals: -300,
    loans: -250,
    transfers: 0,
    other: 0,
    netMovement: 950
  },
  counts: { transactions: 4, merchants: 3, categories: 1 },
  byCategory: [
    {
      categoryId: 'cat-1',
      name: 'Alimentari',
      color: '#3f8f4f',
      amount: 500,
      transactionCount: 2,
      percentage: 100
    }
  ],
  byMerchant: [
    {
      merchantId: 'm-1',
      name: 'ESSELUNGA',
      category: 'Alimentari',
      amount: 300,
      transactionCount: 1,
      percentage: 60
    },
    {
      merchantId: 'm-2',
      name: 'CARREFOUR',
      category: 'Alimentari',
      amount: 200,
      transactionCount: 1,
      percentage: 40
    }
  ],
  timeline: {
    granularity: 'week',
    buckets: [
      {
        period: '2026-07-06',
        partial: false,
        income: 2000,
        expenses: 500,
        withdrawals: -300,
        loans: -250,
        transfers: 0,
        netMovement: 950
      }
    ]
  },
  loans: {
    lent: 250,
    transactionCount: 1,
    entries: [
      {
        id: 'l-1',
        bookingDate: '2026-07-05',
        description: 'PRESTITO A MARIO',
        merchant: 'PRESTITO A MARIO',
        amount: -250
      }
    ]
  },
  ...overrides
});

const empty = (): Analytics =>
  analytics({
    overview: {
      income: 0,
      expenses: 0,
      balance: 0,
      withdrawals: 0,
      loans: 0,
      transfers: 0,
      other: 0,
      netMovement: 0
    },
    counts: { transactions: 0, merchants: 0, categories: 0 },
    byCategory: [],
    byMerchant: [],
    timeline: { granularity: 'week', buckets: [] },
    loans: { lent: 0, transactionCount: 0, entries: [] }
  });

const RANGE = 'from=2026-01-01&to=2026-12-31';
/** Il passo chiude sempre la query string: viene aggiunto per ultimo. */
const STEP = 'granularity=week';
const PERIOD = `${RANGE}&${STEP}`;

describe('AnalyticsPage', () => {
  let fixture: ComponentFixture<AnalyticsPage>;
  let http: HttpTestingController;
  let store: AnalyticsStore;

  const text = (): string =>
    ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\./g, '');

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  /** Risponde alle richieste di contorno: categorie e merchant dei filtri. */
  const flushLookups = async (): Promise<void> => {
    for (const request of http.match(`${API_BASE_URL}/categories`)) {
      request.flush([{ id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' }]);
    }
    for (const request of http.match(`${API_BASE_URL}/merchants/summary`)) {
      request.flush([]);
    }
    await settle();
  };

  const flush = async (data: Analytics, query: string = PERIOD): Promise<void> => {
    const url = query === '' ? `${API_BASE_URL}/analytics` : `${API_BASE_URL}/analytics?${query}`;
    http.expectOne(url).flush(data);
    await settle();
    await flushLookups();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalyticsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'transactions', component: StubTransactionsPage }])
      ],
      // Una richiesta fallita è uno scenario da verificare, non un errore del test.
      rethrowApplicationErrors: false
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AnalyticsStore);
    store.resetFilters();
    store.setCustomRange('2026-01-01', '2026-12-31');

    fixture = TestBed.createComponent(AnalyticsPage);
  });

  afterEach(() => http.verify());

  it('mostra il caricamento e poi tutte le sezioni', async () => {
    await settle();
    expect(text()).toContain('Caricamento in corso');

    await flush(analytics());

    expect(text()).toContain('Andamento nel tempo');
    expect(text()).toContain('Spese per categoria');
    expect(text()).toContain('Merchant principali');
    expect(text()).toContain('Prestiti');
  });

  it('è una dashboard: non contiene più la tabella dei movimenti', async () => {
    await settle();
    await flush(analytics());

    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('app-transactions-table')).toBeNull();
    expect(host.querySelector('table')).toBeNull();
  });

  it('mostra i KPI, separando prelievi e prestiti dalle uscite', async () => {
    await settle();
    await flush(analytics());

    expect(text()).toContain('Entrate');
    expect(text()).toContain('2000,00');
    expect(text()).toContain('Uscite');
    expect(text()).toContain('500,00');
    expect(text()).toContain('Prelievi');
    expect(text()).toContain('-300,00');
  });

  it('chiede al backend il periodo selezionato', async () => {
    await settle();
    await flush(analytics());

    store.selectPreset('all');
    await settle();
    await flush(analytics(), STEP);

    expect(store.selectedPeriodLabel()).toBe('Tutto');
  });

  it('un cambio di filtro aggiorna tutte le sezioni', async () => {
    await settle();
    await flush(analytics());
    expect(text()).toContain('CARREFOUR');

    store.toggleCategory('cat-1');
    await settle();
    await flush(
      analytics({
        overview: { ...analytics().overview, expenses: 300 },
        counts: { transactions: 1, merchants: 1, categories: 1 },
        byMerchant: [
          {
            merchantId: 'm-1',
            name: 'ESSELUNGA',
            category: 'Alimentari',
            amount: 300,
            transactionCount: 1,
            percentage: 100
          }
        ]
      }),
      `${RANGE}&categoryIds=cat-1&${STEP}`
    );

    expect(text()).not.toContain('CARREFOUR');
    expect(text()).toContain('300,00');
  });

  it('spiega che non ci sono dati invece di mostrare sezioni vuote', async () => {
    await settle();
    await flush(empty());

    expect(text()).toContain('Nessun dato disponibile per il periodo selezionato');
    expect(text()).not.toContain('Andamento nel tempo');
    expect(text()).toContain('Entrate');
  });

  it('mostra l\'errore restituito dal backend', async () => {
    await settle();
    http
      .expectOne(`${API_BASE_URL}/analytics?${PERIOD}`)
      .flush(
        { error: 'Intervallo non valido: la data iniziale è successiva a quella finale.' },
        { status: 400, statusText: 'Bad Request' }
      );
    await settle();
    await flushLookups();

    expect(text()).toContain('Intervallo non valido');
  });
});

describe('AnalyticsPage: deep link verso l\'esplorazione', () => {
  let fixture: ComponentFixture<AnalyticsPage>;
  let http: HttpTestingController;
  let store: AnalyticsStore;
  let router: Router;

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const load = async (data: Analytics = analytics()): Promise<void> => {
    await settle();
    http.expectOne(`${API_BASE_URL}/analytics?${PERIOD}`).flush(data);
    await settle();
    for (const request of http.match(`${API_BASE_URL}/categories`)) {
      request.flush([{ id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' }]);
    }
    for (const request of http.match(`${API_BASE_URL}/merchants/summary`)) {
      request.flush([]);
    }
    await settle();
  };

  const click = async (selector: string): Promise<void> => {
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector)?.click();
    await settle();
    await settle();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalyticsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'transactions', component: StubTransactionsPage }])
      ]
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AnalyticsStore);
    router = TestBed.inject(Router);
    store.resetFilters();
    store.setCustomRange('2026-07-01', '2026-07-31');
    store.setCustomRange('2026-01-01', '2026-12-31');

    fixture = TestBed.createComponent(AnalyticsPage);
  });

  afterEach(() => http.verify());

  it('una categoria porta ai suoi movimenti, mantenendo il periodo', async () => {
    await load();
    await click('app-analytics-categories .row');

    expect(router.url).toContain('/transactions');
    expect(router.url).toContain('from=2026-01-01');
    expect(router.url).toContain('to=2026-12-31');
    expect(router.url).toContain('categoryIds=cat-1');
    expect(router.url).toContain('types=EXPENSE');
  });

  it('una categoria senza nome porta ai movimenti da classificare', async () => {
    await load(
      analytics({
        byCategory: [
          {
            categoryId: null,
            name: 'Senza categoria',
            color: null,
            amount: 40,
            transactionCount: 1,
            percentage: 100
          }
        ]
      })
    );
    await click('app-analytics-categories .row');

    expect(router.url).toContain('classification=unclassified');
    expect(router.url).toContain('from=2026-01-01');
    expect(router.url).not.toContain('categoryIds');
  });

  it('un merchant porta ai propri movimenti', async () => {
    await load();
    await click('app-analytics-merchants .link');

    expect(router.url).toContain('merchantIds=m-1');
    expect(router.url).toContain('from=2026-01-01');
  });

  it('i prestiti portano ai movimenti di tipo LOAN', async () => {
    await load();
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      'app-analytics-loans .explore a.movements'
    );

    expect(link?.getAttribute('href')).toContain('types=LOAN');
    expect(link?.getAttribute('href')).toContain('from=2026-01-01');
  });

  it('il collegamento generale porta almeno il periodo', async () => {
    await load();
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      '.explore.all a'
    );

    expect(link?.getAttribute('href')).toContain('/transactions');
    expect(link?.getAttribute('href')).toContain('from=2026-01-01');
    expect(link?.getAttribute('href')).toContain('to=2026-12-31');
  });

  it('porta con sé anche i filtri già attivi in Analytics', async () => {
    store.toggleType('EXPENSE');
    await settle();
    http.expectOne(`${API_BASE_URL}/analytics?${RANGE}&types=EXPENSE&${STEP}`).flush(analytics());
    await settle();
    for (const request of http.match(`${API_BASE_URL}/categories`)) {
      request.flush([]);
    }
    for (const request of http.match(`${API_BASE_URL}/merchants/summary`)) {
      request.flush([]);
    }
    await settle();

    await click('app-analytics-merchants .link');

    expect(router.url).toContain('types=EXPENSE');
    expect(router.url).toContain('merchantIds=m-1');
  });
});
