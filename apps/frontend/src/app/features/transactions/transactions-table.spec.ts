import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api';
import { Transaction } from './transaction.model';
import { TransactionsTable } from './transactions-table';

const transaction = (id: string, amount: number): Transaction => ({
  id,
  bookingDate: '2026-07-10',
  description: `Movimento ${id}`,
  amount,
  type: amount < 0 ? 'EXPENSE' : 'INCOME',
  merchant: null
});

describe('TransactionsTable', () => {
  let fixture: ComponentFixture<TransactionsTable>;
  let http: HttpTestingController;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /**
   * Il componente carica le categorie da solo in `ngOnInit`: ogni test deve
   * rispondere a quella richiesta, o `http.verify()` in `afterEach` fallisce.
   */
  const render = async (transactions: readonly Transaction[]): Promise<void> => {
    fixture.componentRef.setInput('transactions', transactions);
    await fixture.whenStable();
    http.expectOne(`${API_BASE_URL}/categories`).flush([]);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransactionsTable],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TransactionsTable);
  });

  afterEach(() => http.verify());

  it('la riga di totale somma gli importi delle transazioni mostrate', async () => {
    await render([transaction('1', -300), transaction('2', 500)]);

    const total = host().querySelector('tfoot .numeric app-amount') as HTMLElement;

    expect(total).not.toBeNull();
    expect(total.textContent?.trim().startsWith('+')).toBe(true);
    expect(total.textContent).toContain('200,00');
  });

  // Un totale negativo resta negativo: la riga non è un'entrata forzata, è la
  // somma con il proprio segno.
  it('la riga di totale mostra il segno meno quando le uscite superano le entrate', async () => {
    await render([transaction('1', -900), transaction('2', 300)]);

    const total = host().querySelector('tfoot .numeric app-amount') as HTMLElement;

    expect(total.textContent?.trim().startsWith('−')).toBe(true);
    expect(total.textContent).toContain('600,00');
  });

  // Il modello di transazione non ha un campo stato (v. transaction.model.ts):
  // niente pastiglie «Completato»/«In attesa» inventate.
  it('non mostra alcuna colonna di stato: il modello non ce l’ha', async () => {
    await render([transaction('1', -300)]);

    expect(host().textContent).not.toContain('Completato');
    expect(host().querySelector('.status')).toBeNull();
  });

  it('l’etichetta del totale dichiara che è il totale del periodo mostrato', async () => {
    await render([transaction('1', -300)]);

    expect(host().querySelector('tfoot .total-label')?.textContent).toContain(
      'periodo mostrato'
    );
  });
});
