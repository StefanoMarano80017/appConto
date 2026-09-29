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

  /*
   * I due test che seguono (Task 6, Step 1) non descrivono un comportamento
   * nuovo: fissano quello di oggi, prima di decidere se la tabella debba
   * adottare l'involucro condiviso `data-table`. Quel mixin porta un padding
   * diverso dall'attuale, quindi la geometria cambierà — ed è proprio quando
   * la geometria cambia che un contenuto lungo smette di starci.
   *
   * Vanno letti al contrario: se un giorno diventano rossi, il verdetto sulle
   * tabelle ha rotto qualcosa che oggi funziona.
   *
   * Quello che jsdom NON può dire, e che nessuno dei due finge di verificare:
   * se il testo esca dalla cella. Qui non c'è layout, `getBoundingClientRect()`
   * vale zero. Si verifica quindi l'unica cosa osservabile — che il contenuto
   * ci sia tutto e nella cella giusta — e il resto resta al giro visivo.
   */

  /** Un merchant con un nome scelto: `label` è ciò che la cella rende. */
  const conMerchant = (id: string, amount: number, label: string): Transaction => ({
    ...transaction(id, amount),
    merchant: {
      id: `m-${id}`,
      name: label,
      displayName: null,
      label,
      normalizedName: label.toLowerCase(),
      category: null
    }
  });

  it('un importo a sei cifre arriva intero nella cella, senza troncamenti', async () => {
    await render([transaction('1', -123456.78)]);

    // `tbody`, non `tfoot`: la riga di totale ha la stessa classe di cella, e
    // senza questo ancoraggio il test misurerebbe il totale invece del dato.
    const cella = host().querySelector('tbody td.numeric');

    expect(cella?.textContent).toContain('123.456,78');
  });

  /*
   * Le intestazioni ordinabili sono `<app-sortable-header>` (Task 6, Step 3).
   * Il componente dichiara `aria-sort` da sé, e la colonna non ordinabile
   * adesso tace invece di dire `none`: i tre test che seguono fissano quel
   * cambio, perché è l'unica parte dell'adozione che si vede solo con uno
   * screen reader e che nessun altro test guardava.
   */
  const conOrdinamento = async (): Promise<void> => {
    fixture.componentRef.setInput('sortBy', 'amount');
    fixture.componentRef.setInput('sortDirection', 'asc');
    await render([transaction('1', -300)]);
  };

  it('dichiara aria-sort solo sulle colonne che si possono davvero ordinare', async () => {
    await conOrdinamento();

    const intestazioni = [...host().querySelectorAll('thead th')];

    expect(intestazioni.length).toBe(6);

    // «Descrizione» è l'unica senza `field` (v. COLUMNS): dichiarare anche lì
    // `aria-sort="none"` direbbe a uno screen reader che la colonna è
    // ordinabile e che semplicemente non lo è adesso. Non lo è affatto.
    const mute = intestazioni.filter((th) => !th.hasAttribute('aria-sort'));

    expect(mute.map((th) => th.textContent?.trim())).toEqual(['Descrizione']);
  });

  it('la colonna ordinata dichiara la direzione, non solo che è attiva', async () => {
    await conOrdinamento();

    expect(host().querySelector('thead th.numeric')?.getAttribute('aria-sort')).toBe(
      'ascending'
    );
  });

  // Dove la tabella è un riepilogo e non un elenco su cui agire — la
  // dashboard — `sortBy` è `null` e nessuna intestazione si clicca.
  it('senza ordinamento nessuna intestazione è un pulsante né si dichiara ordinabile', async () => {
    await render([transaction('1', -300)]);

    expect(host().querySelector('thead .sort')).toBeNull();
    expect(host().querySelector('thead th[aria-sort]')).toBeNull();
  });

  it('un nome di merchant lunghissimo resta intero e non fa sparire la cella dell’importo', async () => {
    const nome = 'Supermercato Cooperativo del Lungo Nome Che Non Finisce Mai';
    await render([conMerchant('1', -300, nome)]);

    // Il nome è reso da uno `<span class="label" appTruncate>`: la direttiva
    // accorcia a schermo, ma il testo nel DOM deve restare intero, o non
    // sarebbe più leggibile né copiabile.
    expect(host().querySelector('tbody td.merchant .label')?.textContent?.trim()).toBe(nome);
    expect(host().querySelector('tbody td.numeric')).not.toBeNull();
  });
});
