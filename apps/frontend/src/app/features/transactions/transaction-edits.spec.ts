import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../core/api';
import { TransactionEdits, createTransactionEdits } from './transaction-edits';
import { Transaction } from './transaction.model';

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: '1',
  bookingDate: '2026-07-10',
  description: 'ESSELUNGA',
  amount: -300,
  type: 'EXPENSE',
  merchant: {
    id: 'm-1',
    name: 'ESSELUNGA',
    displayName: null,
    label: 'ESSELUNGA',
    normalizedName: 'esselunga',
    category: { id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' },
  },
  ...overrides,
});

describe('createTransactionEdits', () => {
  let http: HttpTestingController;
  let edits: TransactionEdits;
  let saved: number;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    http = TestBed.inject(HttpTestingController);
    saved = 0;
    // Inietta le proprie API: fuori da un contesto d'iniezione non funziona.
    edits = TestBed.runInInjectionContext(() => createTransactionEdits(() => saved++));
  });

  afterEach(() => http.verify());

  it('corregge il tipo del movimento e, salvato, chiede di ricaricare', () => {
    edits.changeType(transaction(), 'WITHDRAWAL');

    expect(edits.savingId()).toBe('1');

    const request = http.expectOne(`${API_BASE_URL}/transactions/1/type`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ type: 'WITHDRAWAL' });
    request.flush({ id: '1', type: 'WITHDRAWAL' });

    expect(edits.savingId()).toBeNull();
    expect(edits.error()).toBeNull();
    expect(saved).toBe(1);
  });

  // La categoria è del merchant, non del movimento: la richiesta va
  // all'esercente, e tutte le sue transazioni la ereditano.
  it('cambia la categoria del merchant, non del movimento', () => {
    edits.changeCategory(transaction(), 'cat-2');

    const request = http.expectOne(`${API_BASE_URL}/merchants/m-1/category`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ categoryId: 'cat-2' });
    request.flush({ id: 'm-1' });

    expect(saved).toBe(1);
  });

  it('`null` toglie la categoria', () => {
    edits.changeCategory(transaction(), null);

    const request = http.expectOne(`${API_BASE_URL}/merchants/m-1/category`);
    expect(request.request.body).toEqual({ categoryId: null });
    request.flush({ id: 'm-1' });
  });

  it('senza merchant non c’è categoria da assegnare: nessuna richiesta', () => {
    edits.changeCategory(transaction({ merchant: null }), 'cat-2');

    http.expectNone(() => true);
    expect(edits.savingId()).toBeNull();
    expect(saved).toBe(0);
  });

  // Anche il fallimento ricarica: il `select` mostra il valore scelto e non
  // salvato, e solo i dati ricaricati riportano a video quello vero.
  it('un errore è leggibile e ricarica comunque, per ripristinare lo stato mostrato', () => {
    edits.changeType(transaction(), 'LOAN');

    http
      .expectOne(`${API_BASE_URL}/transactions/1/type`)
      .flush(
        { error: 'Tipo non ammesso per questo movimento.' },
        { status: 400, statusText: 'Bad Request' },
      );

    expect(edits.error()).toContain('Tipo non ammesso');
    expect(edits.savingId()).toBeNull();
    expect(saved).toBe(1);
  });

  it('un nuovo salvataggio azzera l’errore del precedente', () => {
    edits.changeType(transaction(), 'LOAN');
    http
      .expectOne(`${API_BASE_URL}/transactions/1/type`)
      .flush({ error: 'No.' }, { status: 400, statusText: 'Bad Request' });
    expect(edits.error()).not.toBeNull();

    edits.changeCategory(transaction(), 'cat-2');

    expect(edits.error()).toBeNull();
    http.expectOne(`${API_BASE_URL}/merchants/m-1/category`).flush({ id: 'm-1' });
  });
});
