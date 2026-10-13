import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { API_BASE_URL } from '../../core/api';
import { DashboardPage } from './dashboard-page';
import { Dashboard } from './dashboard.model';

const dashboard = (overrides: Partial<Dashboard> = {}): Dashboard => ({
  month: '2026-09',
  today: '2026-10-13',
  lastTransactionDate: '2026-09-21',
  summary: { income: 1780.35, expenses: 134.95, balance: 1645.4, withdrawals: 0 },
  comparison: {
    previousExpenses: 843.44,
    percentChange: -84,
    previousFrom: '2026-08-01',
    previousTo: '2026-08-31',
    currentTo: null,
    partial: false
  },
  topCategories: [
    {
      id: 'cat-1',
      name: 'Intrattenimento',
      color: '#3f8f4f',
      amount: 42.7,
      percentage: 31.6,
      difference: 12.3
    }
  ],
  recentTransactions: [
    {
      id: 't-1',
      bookingDate: '2026-09-21',
      label: 'HOPPY ENDING NAPOLI',
      type: 'EXPENSE',
      category: { id: 'cat-1', name: 'Intrattenimento', color: '#3f8f4f' },
      amount: -7
    }
  ],
  attention: { unclassifiedMerchants: 17 },
  loans: { remaining: 1030, openCount: 2, unlinkedTransactions: 0 },
  ...overrides
});

describe('DashboardPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const element = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const text = (): string => (element().textContent ?? '').replace(/\s+/g, ' ');

  /** Risponde all'unica richiesta della pagina e ne restituisce l'indirizzo. */
  const flush = async (data: Dashboard = dashboard()): Promise<string> => {
    const request = http.expectOne((candidate) => candidate.url === `${API_BASE_URL}/dashboard`);
    const url = request.request.urlWithParams;
    request.flush(data);
    await settle();

    return url;
  };

  const open = async (url: string): Promise<void> => {
    await harness.navigateByUrl(url, DashboardPage);
    await settle();
  };

  const arrow = (label: string): HTMLButtonElement =>
    element().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: '', component: DashboardPage }])
      ]
    });

    harness = await RouterTestingHarness.create();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  it('senza mese nell\'URL lo sceglie il backend', async () => {
    await open('/');

    expect(await flush()).toBe(`${API_BASE_URL}/dashboard`);
  });

  it('il mese nell\'URL diventa la richiesta', async () => {
    await open('/?month=2026-08');

    expect(await flush()).toBe(`${API_BASE_URL}/dashboard?month=2026-08`);
  });

  it('un mese non valido nell\'URL si ignora', async () => {
    await open('/?month=2026-13');

    expect(await flush()).toBe(`${API_BASE_URL}/dashboard`);
  });

  it('mostra «Caricamento in corso…» al primo caricamento', async () => {
    await open('/');

    expect(text()).toContain('Caricamento in corso');

    await flush();
  });

  it('mostra le tre card essenziali, con il confronto sulle uscite', async () => {
    await open('/');
    await flush();

    expect(text()).toContain('Entrate');
    expect(text()).toContain('Uscite');
    expect(text()).toContain('Risultato del mese');
    expect(text()).not.toContain('Transazioni');
    expect(text()).not.toContain('Merchant');
    expect(element().querySelector('.delta-caption')?.textContent?.trim()).toBe('vs agosto');
    expect(text()).toContain('settembre 2026');
  });

  it('senza variazione calcolabile le uscite non hanno confronto', async () => {
    await open('/');
    await flush(
      dashboard({ comparison: { ...dashboard().comparison, previousExpenses: 0, percentChange: null } })
    );

    expect(element().querySelector('.delta')).toBeNull();
  });

  it('i prelievi compaiono solo se ce ne sono', async () => {
    await open('/');
    await flush(dashboard({ summary: { ...dashboard().summary, withdrawals: 200 } }));

    expect(text()).toContain('Prelevati in contanti');
    expect(text()).toContain('non inclusi nelle uscite');

    await open('/?month=2026-08');
    await flush(dashboard({ month: '2026-08', summary: { ...dashboard().summary, withdrawals: 0 } }));

    expect(text()).not.toContain('Prelevati in contanti');
  });

  it('dice a quando risalgono i dati', async () => {
    await open('/');
    await flush();

    expect(text()).toContain('Dati aggiornati al 21/09/2026');
  });

  it('senza movimenti non dice a quando risalgono i dati', async () => {
    await open('/');
    await flush(dashboard({ lastTransactionDate: null }));

    expect(text()).not.toContain('Dati aggiornati');
  });

  it('la freccia › è disabilitata sul mese in corso', async () => {
    await open('/');
    await flush(dashboard({ month: '2026-10' }));

    expect(arrow('Mese successivo').disabled).toBe(true);
    expect(arrow('Mese precedente').disabled).toBe(false);
  });

  it('le frecce portano il mese nell\'URL', async () => {
    await open('/');
    await flush();

    expect(arrow('Mese successivo').disabled).toBe(false);

    arrow('Mese precedente').click();
    await settle();

    expect(router.url).toBe('/?month=2026-08');
    expect(await flush(dashboard({ month: '2026-08' }))).toBe(
      `${API_BASE_URL}/dashboard?month=2026-08`
    );

    arrow('Mese successivo').click();
    await settle();

    expect(router.url).toBe('/?month=2026-09');
    await flush();
  });

  it('cambiando mese il contenuto precedente resta visibile', async () => {
    await open('/');
    await flush();

    arrow('Mese precedente').click();
    await settle();

    expect(text()).toContain('settembre 2026');
    expect(text()).not.toContain('Caricamento in corso');

    await flush(dashboard({ month: '2026-08' }));

    expect(text()).toContain('agosto 2026');
  });

  it('un errore si può riprovare', async () => {
    await open('/');
    http
      .expectOne(`${API_BASE_URL}/dashboard`)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    await settle();

    const retry = element().querySelector<HTMLButtonElement>('app-error-retry button');
    expect(retry).not.toBeNull();

    retry!.click();
    await settle();
    await flush();

    expect(text()).toContain('Risultato del mese');
    expect(element().querySelector('app-error-retry')).toBeNull();
  });
});
