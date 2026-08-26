import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { API_BASE_URL } from '../../core/api';
import { EMPTY_LOAN_QUERY } from './loan-query';
import { LoanList, LoanSummary } from './loan.model';
import { LoansPage } from './loans-page';

const loan = (overrides: Partial<LoanSummary> = {}): LoanSummary => ({
  id: 'l-1',
  transactionId: 't-1',
  borrowerName: 'Mamma',
  description: 'Acquisto fatto per lei',
  lentAt: '2026-08-10',
  amount: 80,
  repaidAmount: 30,
  remainingAmount: 50,
  status: 'OPEN',
  repaymentCount: 1,
  ...overrides
});

const list = (overrides: Partial<LoanList> = {}): LoanList => ({
  query: EMPTY_LOAN_QUERY,
  totals: { lent: 1250, repaid: 700, remaining: 550, openCount: 4, loanCount: 5 },
  borrowers: ['Anna', 'Mamma'],
  items: [
    loan(),
    loan({
      id: 'l-2',
      borrowerName: 'Anna',
      description: 'Assicurazione Kia',
      amount: 1100,
      repaidAmount: 1100,
      remainingAmount: 0,
      status: 'SETTLED',
      repaymentCount: 2
    })
  ],
  ...overrides
});

describe('LoansPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const text = (): string => harness.routeNativeElement?.textContent ?? '';

  /** Risponde all'elenco in corso, qualunque sia la query string. */
  const flush = async (data: LoanList = list()): Promise<string> => {
    const [request] = http.match((candidate) =>
      candidate.url.startsWith(`${API_BASE_URL}/loans`)
    );
    expect(request).toBeDefined();
    const url = request!.request.urlWithParams;
    request!.flush(data);
    await settle();

    return url;
  };

  const open = async (url: string): Promise<void> => {
    await harness.navigateByUrl(url, LoansPage);
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
        provideRouter([{ path: 'loans', component: LoansPage }])
      ],
      rethrowApplicationErrors: false
    });

    harness = await RouterTestingHarness.create();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  it('mostra i KPI della posizione di credito', async () => {
    await open('/loans');
    await flush();

    expect(text()).toContain('Prestato');
    expect(text()).toContain('Restituito');
    expect(text()).toContain('Da ricevere');
    expect(text()).toContain('Aperti');
    // I quattro numeri dell'esempio del capitolato.
    expect(text()).toContain('550,00');
    expect(text()).toContain('4');
  });

  it('mostra prestato, restituito e residuo di ogni prestito', async () => {
    await open('/loans');
    await flush();

    expect(text()).toContain('Mamma');
    expect(text()).toContain('Acquisto fatto per lei');
    expect(text()).toContain('80,00');
    expect(text()).toContain('30,00');
    expect(text()).toContain('50,00');
    expect(text()).toContain('Aperto');
    expect(text()).toContain('Chiuso');
  });

  it('un prestito chiuso si distingue da uno aperto', async () => {
    await open('/loans');
    await flush();

    const rows = harness.routeNativeElement?.querySelectorAll('tbody tr');
    expect(rows?.length).toBe(2);
    expect(rows?.[0]?.classList.contains('settled')).toBe(false);
    expect(rows?.[1]?.classList.contains('settled')).toBe(true);
  });

  it('senza criteri chiede l\'elenco completo, dal residuo più grande', async () => {
    await open('/loans');
    const url = await flush();

    expect(url).toBe(`${API_BASE_URL}/loans`);
  });

  it('i criteri nell\'URL diventano la richiesta', async () => {
    await open('/loans?status=open&borrower=Anna&search=lego&sortBy=lentAt&sortDirection=asc');
    const url = await flush();

    expect(url).toContain('status=open');
    expect(url).toContain('borrower=Anna');
    expect(url).toContain('search=lego');
    expect(url).toContain('sortBy=lentAt');
    expect(url).toContain('sortDirection=asc');
  });

  it('scegliere uno stato lo scrive nell\'URL', async () => {
    await open('/loans');
    await flush();

    await click('.filters button:nth-of-type(2)');

    expect(router.url).toContain('status=open');
    await flush();
  });

  it('ordinare per una colonna finisce nell\'URL', async () => {
    await open('/loans');
    await flush();

    await click('thead .sort');

    expect(router.url).toContain('sortBy=borrower');
    await flush();
  });

  it('il link di ogni prestito porta al suo dettaglio', async () => {
    await open('/loans');
    await flush();

    const link = harness.routeNativeElement?.querySelector<HTMLAnchorElement>(
      '.borrower-name a'
    );

    expect(link?.getAttribute('href')).toBe('/loans/l-1');
  });

  it('senza prestiti spiega da dove si comincia', async () => {
    await open('/loans');
    await flush(
      list({
        items: [],
        borrowers: [],
        totals: { lent: 0, repaid: 0, remaining: 0, openCount: 0, loanCount: 0 }
      })
    );

    expect(text()).toContain('Nessun prestito registrato');
    const link = harness.routeNativeElement?.querySelector<HTMLAnchorElement>('.hint a');
    expect(link?.getAttribute('href')).toContain('types=LOAN');
  });

  it('con criteri attivi e nessun risultato propone di azzerarli', async () => {
    await open('/loans?search=inesistente');
    await flush(
      list({
        items: [],
        totals: { lent: 0, repaid: 0, remaining: 0, openCount: 0, loanCount: 0 }
      })
    );

    expect(text()).toContain('Nessun prestito corrisponde');
    expect(text()).toContain('Azzera filtri');
  });

  it('un errore è leggibile e riprovabile', async () => {
    await open('/loans');

    const [request] = http.match((candidate) =>
      candidate.url.startsWith(`${API_BASE_URL}/loans`)
    );
    request!.flush({ error: 'Database non raggiungibile.' }, { status: 500, statusText: 'Error' });
    await settle();

    expect(text()).toContain('Database non raggiungibile');

    await click('.retry');
    await flush();

    expect(text()).toContain('Mamma');
  });
});
