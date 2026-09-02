import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { API_BASE_URL } from '../../core/api';
import { TransactionPage } from './transaction.model';
import { TransactionsPage } from './transactions-page';

/**
 * Selezionare ed eliminare i movimenti.
 *
 * Le cose che contano qui: che la selezione sopravviva a un ricaricamento dei
 * dati, che l'eliminazione sia **una** richiesta per l'intero insieme, che la
 * conferma esista, e che un rifiuto del backend non faccia perdere la
 * selezione — perché il messaggio dice cosa toglierne.
 */

const transaction = (id: string, description: string) => ({
  id,
  bookingDate: '2026-07-10',
  description,
  amount: -100,
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

const page = (): TransactionPage => ({
  items: [
    transaction('1', 'ESSELUNGA'),
    transaction('2', 'CARREFOUR'),
    transaction('3', 'CONAD')
  ],
  pagination: { page: 1, pageSize: 25, total: 3, totalPages: 1 }
});

describe('TransactionsPage — selezione ed eliminazione', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const text = (): string => harness.routeNativeElement?.textContent ?? '';

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

  const flush = async (data: TransactionPage = page()): Promise<void> => {
    const [request] = http.match((candidate) =>
      candidate.url.startsWith(`${API_BASE_URL}/transactions`)
    );
    expect(request).toBeDefined();
    request!.flush(data);
    await settle();
    await flushLookups();
  };

  /** Le caselle di selezione delle righe, nell'ordine in cui compaiono. */
  const checkboxes = (): HTMLInputElement[] =>
    Array.from(harness.routeNativeElement?.querySelectorAll<HTMLInputElement>('td.select input') ?? []);

  const headerCheckbox = (): HTMLInputElement | null =>
    harness.routeNativeElement?.querySelector<HTMLInputElement>('th.select input') ?? null;

  const toggle = async (index: number): Promise<void> => {
    checkboxes()[index]?.click();
    await settle();
  };

  /** Il pulsante il cui testo contiene la parola indicata. */
  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(
      harness.routeNativeElement?.querySelectorAll<HTMLButtonElement>('.selection button') ?? []
    ).find((candidate) => (candidate.textContent ?? '').includes(label));

  const click = async (label: string): Promise<void> => {
    button(label)?.click();
    await settle();
    await settle();
  };

  const open = async (url = '/transactions'): Promise<void> => {
    await harness.navigateByUrl(url, TransactionsPage);
    await settle();
    await flush();
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
  });

  afterEach(() => http.verify());

  it('senza selezione la barra delle azioni non esiste', async () => {
    await open();

    // Una barra sempre presente ma quasi sempre inerte è rumore, e sposta la
    // tabella verso il basso senza motivo.
    expect(harness.routeNativeElement?.querySelector('.selection')).toBeNull();
    expect(checkboxes().length).toBe(3);
  });

  it('selezionando una riga compare il conteggio', async () => {
    await open();
    await toggle(0);

    expect(text()).toContain('1 movimento selezionato');
    expect(button('Elimina')).toBeDefined();
  });

  it('il plurale segue il conteggio', async () => {
    await open();
    await toggle(0);
    await toggle(1);

    expect(text()).toContain('2 movimenti selezionati');
  });

  it('la casella in testa seleziona e deseleziona tutte le righe mostrate', async () => {
    await open();

    headerCheckbox()?.click();
    await settle();
    expect(text()).toContain('3 movimenti selezionati');
    expect(checkboxes().every((casella) => casella.checked)).toBe(true);

    headerCheckbox()?.click();
    await settle();
    expect(harness.routeNativeElement?.querySelector('.selection')).toBeNull();
  });

  it('il primo clic su Elimina chiede conferma e non manda niente', async () => {
    await open();
    await toggle(0);
    await click('Elimina');

    expect(text()).toContain('Eliminare definitivamente?');
    // Nessuna richiesta: `http.verify()` in `afterEach` lo pretende, e qui lo
    // si dice esplicitamente perché è il punto del test.
    http.expectNone((candidate) => candidate.method === 'DELETE');
  });

  it('la conferma manda una sola richiesta con tutti gli identificativi', async () => {
    await open();
    await toggle(0);
    await toggle(2);
    await click('Elimina');
    await click('Sì, elimina');

    const [richiesta] = http.match(
      (candidate) => candidate.method === 'DELETE' && candidate.url === `${API_BASE_URL}/transactions`
    );

    expect(richiesta).toBeDefined();
    // Una sola richiesta per l'intero insieme: se fossero indipendenti, un
    // guasto a metà lascerebbe la selezione eliminata in parte.
    expect(http.match((candidate) => candidate.method === 'DELETE').length).toBe(0);
    expect(richiesta!.request.body).toEqual({ ids: ['1', '3'] });

    richiesta!.flush({ requested: 2, deleted: 2, notFound: [] });
    await settle();

    expect(text()).toContain('2 movimenti eliminati');
    // I dati vengono ricaricati, e la selezione è vuota.
    await flush({ items: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
    expect(harness.routeNativeElement?.querySelector('.selection .count')).toBeNull();
  });

  it('annullare la conferma non elimina niente e mantiene la selezione', async () => {
    await open();
    await toggle(0);
    await click('Elimina');
    await click('Annulla');

    expect(text()).toContain('1 movimento selezionato');
    expect(text()).not.toContain('Eliminare definitivamente?');
    http.expectNone((candidate) => candidate.method === 'DELETE');
  });

  it('riporta quando qualcosa non esisteva più', async () => {
    await open();
    await toggle(0);
    await click('Elimina');
    await click('Sì, elimina');

    const [richiesta] = http.match((candidate) => candidate.method === 'DELETE');
    richiesta!.flush({ requested: 1, deleted: 0, notFound: ['1'] });
    await settle();

    // Non è un errore: significa che la schermata era vecchia, e vale dirlo.
    expect(text()).toContain('non esistevano più');
    await flush();
  });

  it('un rifiuto del backend mostra il motivo e NON perde la selezione', async () => {
    await open();
    await toggle(0);
    await toggle(1);
    await click('Elimina');
    await click('Sì, elimina');

    const [richiesta] = http.match((candidate) => candidate.method === 'DELETE');
    richiesta!.flush(
      { error: 'Un movimento selezionato è collegato a: prestito a Marco.' },
      { status: 409, statusText: 'Conflict' }
    );
    await settle();

    expect(text()).toContain('prestito a Marco');
    /*
     * La selezione resta: il messaggio dice cosa toglierne, e ricominciare da
     * zero sarebbe una punizione per aver provato.
     */
    expect(text()).toContain('2 movimenti selezionati');
  });

  it('cambiando i criteri la selezione si azzera', async () => {
    await open();
    await toggle(0);
    expect(text()).toContain('1 movimento selezionato');

    await harness.navigateByUrl('/transactions?types=INCOME', TransactionsPage);
    await settle();
    await flush();

    /*
     * Restare selezionati fuori da ciò che si vede sarebbe un'insidia: si
     * filtra, si seleziona, si toglie il filtro, e il pulsante direbbe
     * «elimina 40 movimenti» di cui la maggior parte non è più a schermo.
     */
    expect(harness.routeNativeElement?.querySelector('.selection')).toBeNull();
  });

  it('la selezione sopravvive a un ricaricamento dei dati', async () => {
    await open();
    await toggle(1);
    expect(text()).toContain('1 movimento selezionato');

    // È ciò che accade correggendo il tipo di un movimento: la tabella viene
    // ricostruita, e una selezione che vivesse dentro di essa sparirebbe.
    const tabella = harness.routeNativeElement?.querySelector('app-transactions-table');
    tabella?.dispatchEvent(new CustomEvent('changed'));
    await settle();
    await flush();

    expect(text()).toContain('1 movimento selezionato');
  });
});
