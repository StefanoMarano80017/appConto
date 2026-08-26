import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { API_BASE_URL } from '../../core/api';
import { Transaction } from '../transactions/transaction.model';
import { LoanCreatePage } from './loan-create-page';
import { LoanLink } from './loan.model';

/** Sta al posto delle pagine verso cui si esce. */
@Component({ template: '' })
class Placeholder {}

/** Il movimento reale che ha motivato la ripartizione: 1.920 € per due auto. */
const movement = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 't-1',
  bookingDate: '2026-04-10',
  description: 'ASSICURAZIONI DUE AUTO',
  amount: -1920,
  type: 'LOAN',
  merchant: null,
  ...overrides
});

const link = (amount: number): LoanLink => ({
  transactionId: 't-1',
  loanId: 'l-1',
  role: 'ORIGIN',
  borrowerName: 'Mamma',
  amount,
  remainingAmount: amount,
  status: 'OPEN'
});

describe('LoanCreatePage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const text = (): string => harness.routeNativeElement?.textContent ?? '';

  /**
   * Il testo senza separatori di migliaia.
   *
   * Il raggruppamento dipende dai dati di localizzazione disponibili: le
   * asserzioni sugli importi non devono dipenderne.
   */
  const amounts = (): string => text().replace(/\./g, '');

  const amountInput = (): HTMLInputElement | null =>
    harness.routeNativeElement?.querySelector<HTMLInputElement>('input[name="amount"]') ?? null;

  const open = async (
    transaction: Transaction = movement(),
    links: LoanLink[] = []
  ): Promise<void> => {
    await harness.navigateByUrl('/loans/new?transactionId=t-1', LoanCreatePage);
    await settle();
    http.expectOne(`${API_BASE_URL}/transactions/t-1`).flush(transaction);
    await settle();
    http.expectOne(`${API_BASE_URL}/loans/links`).flush({ links });
    await settle();
  };

  /** Scrive nel campo importo come farebbe l'utente. */
  const type = async (value: string): Promise<void> => {
    const input = amountInput();
    if (input !== null) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await settle();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'loans', component: Placeholder },
          { path: 'loans/new', component: LoanCreatePage },
          { path: 'loans/:id', component: Placeholder }
        ])
      ],
      rethrowApplicationErrors: false
    });

    harness = await RouterTestingHarness.create();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('mostra il movimento e precompila importo e data', async () => {
    await open();

    expect(text()).toContain('ASSICURAZIONI DUE AUTO');
    expect(amountInput()?.value).toBe('1920.00');
    expect(
      harness.routeNativeElement?.querySelector<HTMLInputElement>('input[name="lentAt"]')?.value
    ).toBe('2026-04-10');
  });

  it('con l\'intero movimento prestato non resta spesa propria', async () => {
    await open();

    expect(text()).toContain('Tutto il movimento è un credito');
  });

  it('un importo inferiore lascia il resto come spesa propria, e lo dice', async () => {
    await open();

    await type('1030');

    expect(amounts()).toContain('890,00');
    expect(text()).toContain('restano una tua spesa');
    expect(text()).toContain('uscite del mese');
  });

  it('la ripartizione segue l\'importo mentre si digita', async () => {
    await open();

    await type('1000');
    expect(amounts()).toContain('920,00');

    await type('500');
    expect(amounts()).toContain('1420,00');
  });

  it('su un movimento già in parte attribuito parte dalla capienza rimasta', async () => {
    await open(movement(), [link(1030)]);

    expect(amountInput()?.value).toBe('890.00');
    expect(text()).toContain('sono già attribuiti ad altri prestiti');
    expect(amounts()).toContain('890,00');
  });

  it('e rifiuta un importo che non ci sta più', async () => {
    await open(movement(), [link(1030)]);

    await type('1000');
    harness.routeNativeElement
      ?.querySelector<HTMLElement>('button[type="submit"]')
      ?.click();
    await settle();

    expect(text()).toContain('il prestito non può valere di più');
    http.expectNone(`${API_BASE_URL}/loans`);
  });

  it('un movimento che non è un prestito non ne può originare uno', async () => {
    await open(movement({ type: 'EXPENSE' }));

    expect(text()).toContain('Un prestito può nascere solo da un movimento di tipo «Prestito»');
    expect(harness.routeNativeElement?.querySelector('form')).toBeNull();
  });

  it('crea il prestito e porta al suo dettaglio', async () => {
    await open();

    await type('1030');
    harness.routeNativeElement?.querySelector<HTMLElement>('input[name="borrowerName"]')?.focus();
    const borrower = harness.routeNativeElement?.querySelector<HTMLInputElement>(
      'input[name="borrowerName"]'
    );
    if (borrower !== null && borrower !== undefined) {
      borrower.value = 'Mamma';
      borrower.dispatchEvent(new Event('input'));
    }
    await settle();

    harness.routeNativeElement?.querySelector<HTMLElement>('button[type="submit"]')?.click();
    await settle();

    const request = http.expectOne(`${API_BASE_URL}/loans`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      transactionId: 't-1',
      borrowerName: 'Mamma',
      description: null,
      amount: 1030,
      lentAt: '2026-04-10'
    });
  });
});
