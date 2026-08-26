import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { API_BASE_URL } from '../../core/api';
import { LoanDetail } from './loan.model';
import { LoanDetailPage } from './loan-detail-page';

/** Sta al posto dell'elenco: la pagina vi torna dopo un'eliminazione. */
@Component({ template: '' })
class LoansPlaceholder {}

const detail = (overrides: Partial<LoanDetail> = {}): LoanDetail => ({
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
  transaction: {
    id: 't-1',
    bookingDate: '2026-08-10',
    description: 'MEDIAWORLD VERANO',
    amount: -80,
    type: 'LOAN'
  },
  originSplit: { amount: 80, lent: 80, ownExpense: 0 },
  transactionTypeMismatch: false,
  repayments: [
    {
      id: 'r-1',
      loanId: 'l-1',
      amount: 30,
      repaymentDate: '2026-08-15',
      note: 'in contanti',
      transaction: null
    }
  ],
  ...overrides
});

describe('LoanDetailPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const text = (): string => harness.routeNativeElement?.textContent ?? '';

  const open = async (data: LoanDetail = detail()): Promise<void> => {
    await harness.navigateByUrl('/loans/l-1', LoanDetailPage);
    await settle();
    http.expectOne(`${API_BASE_URL}/loans/l-1`).flush(data);
    await settle();
  };

  const click = async (selector: string): Promise<void> => {
    harness.routeNativeElement?.querySelector<HTMLElement>(selector)?.click();
    await settle();
    await settle();
  };

  /** Aprire il modulo carica i movimenti in entrata collegabili. */
  const flushCandidates = async (): Promise<void> => {
    for (const request of http.match((candidate) =>
      candidate.url.startsWith(`${API_BASE_URL}/transactions`)
    )) {
      request.flush({
        items: [
          {
            id: 't-9',
            bookingDate: '2026-08-20',
            description: 'BONIFICO DA MAMMA',
            amount: 20,
            type: 'INCOME',
            merchant: null
          }
        ],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 }
      });
    }
    await settle();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'loans', component: LoansPlaceholder },
          { path: 'loans/:id', component: LoanDetailPage }
        ])
      ],
      rethrowApplicationErrors: false
    });

    harness = await RouterTestingHarness.create();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('mostra persona, importi, stato e movimento d\'origine', async () => {
    await open();

    expect(text()).toContain('Mamma');
    expect(text()).toContain('Acquisto fatto per lei');
    expect(text()).toContain('80,00');
    expect(text()).toContain('30,00');
    expect(text()).toContain('50,00');
    expect(text()).toContain('Aperto');
    expect(text()).toContain('MEDIAWORLD VERANO');
  });

  it('una restituzione in contanti si vede come tale', async () => {
    await open();

    expect(text()).toContain('Contanti');
    expect(text()).toContain('in contanti');
  });

  it('una restituzione bancaria mostra il movimento collegato', async () => {
    await open(
      detail({
        repayments: [
          {
            id: 'r-1',
            loanId: 'l-1',
            amount: 30,
            repaymentDate: '2026-08-15',
            note: null,
            transaction: {
              id: 't-9',
              bookingDate: '2026-08-15',
              description: 'BONIFICO DA MAMMA',
              amount: 30,
              type: 'INCOME'
            }
          }
        ]
      })
    );

    expect(text()).toContain('BONIFICO DA MAMMA');
    expect(text()).not.toContain('Contanti');
  });

  it('il modulo di restituzione parte dal credito residuo', async () => {
    await open();

    await click('.header button');
    await flushCandidates();

    const amount = harness.routeNativeElement?.querySelector<HTMLInputElement>(
      'input[name="repaymentAmount"]'
    );
    expect(amount?.value).toBe('50.00');
    expect(text()).toContain('Restano da ricevere');
  });

  it('registrare una restituzione aggiorna il residuo con la risposta del backend', async () => {
    await open();
    await click('.header button');
    await flushCandidates();

    await click('.loan-form.inline button[type="submit"]');

    const request = http.expectOne(`${API_BASE_URL}/loans/l-1/repayments`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      amount: 50,
      repaymentDate: expect.any(String),
      note: null,
      transactionId: null
    });

    request.flush(
      detail({
        repaidAmount: 80,
        remainingAmount: 0,
        status: 'SETTLED',
        repaymentCount: 2,
        repayments: [
          {
            id: 'r-2',
            loanId: 'l-1',
            amount: 50,
            repaymentDate: '2026-08-25',
            note: null,
            transaction: null
          }
        ]
      })
    );
    await settle();

    expect(text()).toContain('Chiuso');
    expect(text()).toContain('0,00');
  });

  it('un prestito chiuso non propone altre restituzioni', async () => {
    await open(detail({ repaidAmount: 80, remainingAmount: 0, status: 'SETTLED' }));

    expect(text()).not.toContain('Registra restituzione');
  });

  it('un prestito con restituzioni non offre l\'eliminazione', async () => {
    await open();

    expect(text()).not.toContain('Elimina prestito');
    expect(text()).toContain('Elimina'); // quella della singola restituzione
  });

  it('un prestito senza restituzioni si elimina, con una conferma', async () => {
    await open(detail({ repaidAmount: 0, remainingAmount: 80, repaymentCount: 0, repayments: [] }));

    const actions = harness.routeNativeElement?.querySelector('.loan-actions');
    expect(actions?.textContent).toContain('Elimina');

    await click('.loan-actions button:nth-of-type(2)');
    expect(text()).toContain('Eliminare il prestito?');

    await click('.loan-actions .danger');
    http.expectOne(`${API_BASE_URL}/loans/l-1`).flush(null, { status: 204, statusText: 'No Content' });
    await settle();
  });

  it('di un prestito parziale spiega quanto resta spesa propria', async () => {
    await open(
      detail({
        amount: 1030,
        repaidAmount: 0,
        remainingAmount: 1030,
        repaymentCount: 0,
        repayments: [],
        transaction: {
          id: 't-1',
          bookingDate: '2026-04-10',
          description: 'ASSICURAZIONI DUE AUTO',
          amount: -1920,
          type: 'LOAN'
        },
        originSplit: { amount: 1920, lent: 1030, ownExpense: 890 }
      })
    );

    const plain = text().replace(/\./g, '');

    expect(text()).toContain('Prestato');
    expect(text()).toContain('Spesa tua');
    expect(plain).toContain('890,00');
    expect(text()).toContain('non sono un credito di nessuno');
    expect(text()).toContain('uscite del mese');
  });

  it('se il movimento è tutto prestato lo dice, invece di tacere', async () => {
    await open(detail({ originSplit: { amount: 80, lent: 80, ownExpense: 0 } }));

    expect(text()).toContain('Tutto il movimento è attribuito a prestiti');
    expect(text()).not.toContain('Spesa tua');
  });

  it('segnala il movimento che non è più un prestito', async () => {
    await open(
      detail({
        transactionTypeMismatch: true,
        transaction: {
          id: 't-1',
          bookingDate: '2026-08-10',
          description: 'MEDIAWORLD VERANO',
          amount: -80,
          type: 'EXPENSE'
        }
      })
    );

    expect(text()).toContain('non è più di tipo');
  });

  it('un errore del backend è leggibile e non cancella ciò che si vede', async () => {
    await open();
    await click('.header button');
    await flushCandidates();

    await click('.loan-form.inline button[type="submit"]');
    http
      .expectOne(`${API_BASE_URL}/loans/l-1/repayments`)
      .flush(
        { error: 'La restituzione supera il credito residuo (50,00 €).' },
        { status: 400, statusText: 'Bad Request' }
      );
    await settle();

    expect(text()).toContain('supera il credito residuo');
    expect(text()).toContain('Mamma');
  });
});
