import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api';
import { EMPTY_QUERY, TransactionQueryState } from '../transactions/transaction-query';
import { Transaction, TransactionPage } from '../transactions/transaction.model';
import { AnalyticsTransactions } from './analytics-transactions';

/** Il solo periodo dell'analisi, senza filtri. */
const periodQuery: TransactionQueryState = {
  ...EMPTY_QUERY,
  from: '2026-01-01',
  to: '2026-12-31'
};

/** Il periodo con una categoria fra i filtri. */
const categoryQuery: TransactionQueryState = {
  ...periodQuery,
  categoryIds: ['cat-1']
};

/** Altri filtri, per i cambi di criteri. */
const otherQuery: TransactionQueryState = {
  ...periodQuery,
  categoryIds: ['cat-2']
};

const transaction = (id: string, description = 'ESSELUNGA'): Transaction => ({
  id,
  bookingDate: '2026-07-10',
  description,
  amount: -30,
  type: 'EXPENSE',
  merchant: null
});

const page = (count: number, total: number, description = 'ESSELUNGA'): TransactionPage => ({
  items: Array.from({ length: count }, (_, i) => transaction(`t-${i}`, description)),
  pagination: { page: 1, pageSize: 25, total, totalPages: Math.max(1, Math.ceil(total / 25)) }
});

describe('AnalyticsTransactions', () => {
  let fixture: ComponentFixture<AnalyticsTransactions>;
  let http: HttpTestingController;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => host().textContent ?? '';
  const title = (): HTMLElement | null => host().querySelector('h2');

  // Non `whenStable()`: aspetterebbe la risposta, che qui la dà il test.
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const render = async (query: TransactionQueryState = categoryQuery): Promise<void> => {
    fixture = TestBed.createComponent(AnalyticsTransactions);
    fixture.componentRef.setInput('query', query);
    await settle();
  };

  const pending = (): TestRequest[] =>
    http.match((request) => request.url === `${API_BASE_URL}/transactions`);

  const respond = async (data: TransactionPage): Promise<void> => {
    const [request] = pending();
    expect(request).toBeDefined();
    request!.flush(data);
    await settle();
  };

  // Chiude i conti con le richieste ancora attese (quelle annullate non contano).
  const finish = async (): Promise<void> => {
    for (const request of pending().filter((candidate) => !candidate.cancelled)) {
      request.flush(page(0, 0));
    }
    await settle();
  };

  beforeEach(async () => {
    // jsdom non implementa scrollIntoView: lo stub serve a verificare che nessuno lo chiami.
    Element.prototype.scrollIntoView = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AnalyticsTransactions],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Nessuna richiesta deve restare aperta: ogni test risponde a quelle ancora attese.
    http.verify();
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it('chiede la prima pagina dei criteri ricevuti, per data decrescente', async () => {
    await render();

    const request = http.expectOne((candidate) => candidate.url === `${API_BASE_URL}/transactions`);
    const params = request.request.params;

    expect(params.get('categoryIds')).toBe('cat-1');
    expect(params.get('from')).toBe('2026-01-01');
    expect(params.get('to')).toBe('2026-12-31');
    // Il pannello non aggiunge criteri suoi: nessun tipo imposto.
    expect(params.has('types')).toBe(false);
    // 25 è il predefinito, e bookingDate/desc l'ordinamento predefinito: non compaiono.
    expect(params.has('pageSize')).toBe(false);
    expect(Number(params.get('page') ?? 1)).toBeLessThanOrEqual(1);
    expect(params.get('sortBy') ?? 'bookingDate').toBe('bookingDate');
    expect(params.get('sortDirection') ?? 'desc').toBe('desc');
  });

  it('il titolo è sempre «Transazioni del periodo», qualunque siano i filtri', async () => {
    for (const query of [periodQuery, categoryQuery, otherQuery]) {
      await render(query);
      expect(title()?.textContent?.trim()).toBe('Transazioni del periodo');
      await respond(page(0, 0));
      fixture.destroy();
    }
  });

  it('non ha comandi propri: i criteri si cambiano solo dai filtri', async () => {
    await render();
    await respond(page(3, 3));

    // Né «Mostra tutto» né la × di una volta: non c'è più una selezione da togliere.
    expect(host().querySelector('app-section-header button')).toBeNull();
    expect(text()).not.toContain('Mostra tutto');
    expect(host().querySelector('button[aria-label="Chiudi dettaglio"]')).toBeNull();
  });

  it('un’anteprima parziale lo dichiara e nasconde il totale', async () => {
    await render();
    await respond(page(25, 312));

    expect(text()).toContain('Mostrate 25 di 312');
    expect(host().querySelectorAll('app-transactions-table tbody tr')).toHaveLength(25);
    expect(host().querySelector('app-transactions-table tfoot')).toBeNull();
  });

  it('quando ci sono tutte, conta e mostra il totale', async () => {
    await render();
    await respond(page(3, 3));

    expect(text()).toContain('3 transazioni');
    expect(text()).not.toContain('Mostrate');
    expect(host().querySelector('app-transactions-table tfoot')).not.toBeNull();

    fixture.destroy();
    await render();
    await respond(page(1, 1));

    expect(text()).toContain('1 transazione');
    expect(text()).not.toContain('1 transazioni');
  });

  it('la tabella è in sola lettura', async () => {
    await render();
    await respond(page(3, 3));

    const table = host().querySelector('app-transactions-table');
    expect(table).not.toBeNull();
    expect(table!.querySelector('select')).toBeNull();
    expect(table!.querySelector('input[type=checkbox]')).toBeNull();
  });

  it('il link apre gli stessi criteri in Movimenti', async () => {
    await render();
    await respond(page(25, 312));

    const link = host().querySelector<HTMLAnchorElement>('a[href*="/transactions"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('Apri in Movimenti →');
    expect(link!.getAttribute('href')).toContain('categoryIds=cat-1');
    expect(link!.getAttribute('href')).toContain('from=2026-01-01');
  });

  it('mostra il caricamento, poi l’errore con riprova', async () => {
    await render();
    expect(text()).toContain('Caricamento in corso…');

    pending()[0].flush('guasto', { status: 500, statusText: 'Server Error' });
    await settle();

    const retry = host().querySelector<HTMLButtonElement>('app-error-retry button');
    expect(retry).not.toBeNull();

    retry!.click();
    await settle();

    expect(pending()).toHaveLength(1);
    await finish();
  });

  it('senza righe lo dice', async () => {
    await render();
    await respond(page(0, 0));

    expect(text()).toContain('Nessuna transazione per i filtri attivi.');
    expect(host().querySelector('app-transactions-table')).toBeNull();
  });

  it('cambiando criteri in volo, vince l’ultimo', async () => {
    await render();
    const [first] = pending();

    fixture.componentRef.setInput('query', otherQuery);
    await settle();

    const [second] = pending().filter((request) => request !== first);
    expect(second.request.params.get('categoryIds')).toBe('cat-2');
    second.flush(page(2, 2, 'CARREFOUR'));
    await settle();

    // La risposta vecchia, se mai arrivasse, non deve più toccare la vista.
    if (!first.cancelled) {
      first.flush(page(4, 4, 'ESSELUNGA'));
      await settle();
    }
    expect(first.cancelled).toBe(true);

    const rows = host().querySelectorAll('app-transactions-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('CARREFOUR');
  });

  it('a ogni cambio di criteri le righe di prima restano attenuate finché non arrivano le nuove', async () => {
    // Qualunque criterio cambi — ricerca, categoria, periodo — le righe sono
    // ancora dei filtri dell'analisi: restano al loro posto, attenuate,
    // invece di sparire e ricomparire.
    const changes: TransactionQueryState[] = [
      { ...categoryQuery, search: 'bio' },
      otherQuery,
      periodQuery,
      { ...periodQuery, from: '2026-07-06', to: '2026-07-12' }
    ];

    await render();
    await respond(page(2, 2, 'ESSELUNGA'));

    for (const [index, query] of changes.entries()) {
      fixture.componentRef.setInput('query', query);
      await settle();

      const content = host().querySelector('.content');
      expect(content?.classList.contains('stale')).toBe(true);
      expect(content?.getAttribute('aria-busy')).toBe('true');
      expect(text()).not.toContain('Caricamento in corso…');
      expect(host().querySelectorAll('app-transactions-table tbody tr')).toHaveLength(2);

      await respond(page(2, 2, `NUOVE-${index}`));

      expect(host().querySelector('.content.stale')).toBeNull();
      expect(host().querySelector('.content')?.getAttribute('aria-busy')).toBe('false');
      const rows = host().querySelectorAll('app-transactions-table tbody tr');
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain(`NUOVE-${index}`);
    }
  });

  it('un cambio di criteri non porta in vista il pannello e non ne sposta il focus', async () => {
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    (document.activeElement as HTMLElement | null)?.blur();
    const before = document.activeElement;

    await render(periodQuery);
    await finish();

    fixture.componentRef.setInput('query', categoryQuery);
    await settle();
    fixture.componentRef.setInput('query', otherQuery);
    await settle();

    expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(before);
    // Il titolo non è un bersaglio del focus da programma.
    expect(title()?.hasAttribute('tabindex')).toBe(false);
    await finish();
  });
});
