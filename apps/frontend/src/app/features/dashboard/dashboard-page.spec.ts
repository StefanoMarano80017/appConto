import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api';
import { DashboardFilterStore } from './dashboard-filter.store';
import { DashboardPage } from './dashboard-page';
import { Dashboard } from './dashboard.model';

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

const dashboard = (overrides: Partial<Dashboard> = {}): Dashboard => ({
  month: '2026-07',
  filters: { type: null, categoryId: null, merchantId: null },
  summary: {
    month: '2026-07',
    income: 1725,
    expenses: 500,
    balance: 1225,
    transactionCount: 2,
    merchantCount: 2,
    amountByCategory: [
      { id: 'cat-1', name: 'Alimentari', color: '#3f8f4f', amount: 500, transactionCount: 2 }
    ],
    uncategorized: { amount: 0, transactionCount: 0 }
  },
  cashFlow: {
    month: '2026-07',
    openingBalance: 2000,
    balanceDate: '2026-06-30',
    income: 1725,
    expenses: 500,
    netMovement: 1225,
    closingBalance: 3225,
    netWorthChange: 1225,
    transactionCount: 2,
    byType: []
  },
  categories: [
    {
      id: 'cat-1',
      name: 'Alimentari',
      color: '#3f8f4f',
      amount: 500,
      transactionCount: 2,
      merchants: [
        {
          id: 'm-1',
          label: 'ESSELUNGA',
          amount: 300,
          transactionCount: 1,
          transactions: [
            { id: '1', bookingDate: '2026-07-10', description: 'ESSELUNGA', amount: 300 }
          ]
        },
        {
          id: 'm-2',
          label: 'CARREFOUR',
          amount: 200,
          transactionCount: 1,
          transactions: [
            { id: '2', bookingDate: '2026-07-11', description: 'CARREFOUR', amount: 200 }
          ]
        }
      ]
    }
  ],
  topMerchants: [
    { id: 'm-1', label: 'ESSELUNGA', amount: 300, transactionCount: 1, categoryName: 'Alimentari' },
    { id: 'm-2', label: 'CARREFOUR', amount: 200, transactionCount: 1, categoryName: 'Alimentari' }
  ],
  comparison: {
    previousMonth: '2026-06',
    currentExpenses: 500,
    previousExpenses: 400,
    difference: 100,
    percentChange: 25,
    byCategory: [
      { id: 'cat-1', name: 'Alimentari', color: '#3f8f4f', current: 500, previous: 400, difference: 100 }
    ]
  },
  transactions: [transaction('1', 'ESSELUNGA', -300), transaction('2', 'CARREFOUR', -200)],
  ...overrides
});

describe('DashboardPage', () => {
  let fixture: ComponentFixture<DashboardPage>;
  let http: HttpTestingController;
  let store: DashboardFilterStore;

  const text = (): string =>
    ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\./g, '');

  /** Risponde alla richiesta della dashboard e a quella delle categorie della tabella. */
  const flush = async (data: Dashboard, url: string): Promise<void> => {
    http.expectOne(url).flush(data);
    await fixture.whenStable();
    for (const request of http.match(`${API_BASE_URL}/categories`)) {
      request.flush([{ id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' }]);
    }
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(DashboardFilterStore);
    store.clearFilters();
    store.setMonth('2026-07');

    fixture = TestBed.createComponent(DashboardPage);
  });

  afterEach(() => http.verify());

  it('carica la dashboard del mese selezionato', async () => {
    await fixture.whenStable();
    await flush(dashboard(), `${API_BASE_URL}/dashboard?month=2026-07`);

    expect(text()).toContain('luglio 2026');
    expect(text()).toContain('500,00');
  });

  it('ricarica tutte le sezioni quando cambia il mese', async () => {
    await fixture.whenStable();
    await flush(dashboard(), `${API_BASE_URL}/dashboard?month=2026-07`);

    store.setMonth('2026-08');
    await fixture.whenStable();
    await flush(
      dashboard({
        month: '2026-08',
        summary: { ...dashboard().summary, month: '2026-08', expenses: 13.49 },
        cashFlow: { ...dashboard().cashFlow, month: '2026-08', closingBalance: 1276.45 },
        transactions: [transaction('3', 'UDEMY', -13.49)]
      }),
      `${API_BASE_URL}/dashboard?month=2026-08`
    );

    expect(text()).toContain('agosto 2026');
    expect(text()).toContain('13,49');
    expect(text()).toContain('1276,45');
  });

  it('propaga i filtri alla richiesta', async () => {
    await fixture.whenStable();
    await flush(dashboard(), `${API_BASE_URL}/dashboard?month=2026-07`);

    store.setCategory('cat-1');
    await fixture.whenStable();
    await flush(dashboard(), `${API_BASE_URL}/dashboard?month=2026-07&categoryId=cat-1`);

    store.setType('WITHDRAWAL');
    await fixture.whenStable();
    await flush(
      dashboard(),
      `${API_BASE_URL}/dashboard?month=2026-07&type=WITHDRAWAL&categoryId=cat-1`
    );

    expect(store.activeCount()).toBe(2);
  });

  it('mostra le transazioni ricevute, coerenti con i filtri', async () => {
    await fixture.whenStable();
    await flush(
      dashboard({ transactions: [transaction('1', 'SOLO QUESTA', -300)] }),
      `${API_BASE_URL}/dashboard?month=2026-07`
    );

    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'app-transactions-table tbody tr'
    );

    expect(rows.length).toBe(1);
    expect(text()).toContain('SOLO QUESTA');
  });

  it('mostra drill down, top merchant e confronto', async () => {
    await fixture.whenStable();
    await flush(dashboard(), `${API_BASE_URL}/dashboard?month=2026-07`);

    expect(text()).toContain('Spese per categoria');
    expect(text()).toContain('Top merchant del mese');
    expect(text()).toContain('Confronto con');
    expect(text()).toContain('ESSELUNGA');
    expect(text()).toContain('+100,00');
  });

  it('filtra per merchant quando se ne sceglie uno dai top', async () => {
    await fixture.whenStable();
    await flush(dashboard(), `${API_BASE_URL}/dashboard?month=2026-07`);

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'app-top-merchants .link'
    );
    button?.click();
    await fixture.whenStable();

    expect(store.filters().merchantId).toBe('m-1');
    await flush(dashboard(), `${API_BASE_URL}/dashboard?month=2026-07&merchantId=m-1`);
  });
});
