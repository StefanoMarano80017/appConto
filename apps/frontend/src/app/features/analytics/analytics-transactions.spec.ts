import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api';
import { EMPTY_QUERY, TransactionQueryState } from '../transactions/transaction-query';
import { Transaction, TransactionPage } from '../transactions/transaction.model';
import { AnalyticsSelectionValue } from './analytics-selection';
import { AnalyticsTransactions } from './analytics-transactions';

const merchantSelection: AnalyticsSelectionValue = {
  kind: 'merchant',
  merchantId: 'm-1',
  name: 'ESSELUNGA'
};

const merchantQuery: TransactionQueryState = { ...EMPTY_QUERY, merchantIds: ['m-1'] };

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

  const render = async (
    selection: AnalyticsSelectionValue = merchantSelection,
    query: TransactionQueryState = merchantQuery
  ): Promise<void> => {
    fixture = TestBed.createComponent(AnalyticsTransactions);
    fixture.componentRef.setInput('selection', selection);
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
    // jsdom non implementa scrollIntoView: senza, il componente solleverebbe.
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

  it('chiede la prima pagina della selezione, per data decrescente', async () => {
    await render();

    const request = http.expectOne((candidate) => candidate.url === `${API_BASE_URL}/transactions`);
    const params = request.request.params;

    expect(params.get('merchantIds')).toBe('m-1');
    // 25 è il predefinito, e bookingDate/desc l'ordinamento predefinito: non compaiono.
    expect(params.has('pageSize')).toBe(false);
    expect(Number(params.get('page') ?? 1)).toBeLessThanOrEqual(1);
    expect(params.get('sortBy') ?? 'bookingDate').toBe('bookingDate');
    expect(params.get('sortDirection') ?? 'desc').toBe('desc');
  });

  it('il titolo dice cosa si sta guardando', async () => {
    const cases: Array<[AnalyticsSelectionValue, string]> = [
      [
        {
          kind: 'period',
          granularity: 'month',
          period: '2026-07',
          range: { from: '2026-07-01', to: '2026-07-31' },
          label: 'Luglio 2026'
        },
        'Luglio 2026'
      ],
      [{ kind: 'category', categoryId: null, name: 'Senza categoria' }, 'Da classificare'],
      [{ kind: 'category', categoryId: 'cat-1', name: 'Alimentari' }, 'Alimentari'],
      [merchantSelection, 'ESSELUNGA']
    ];

    for (const [selection, label] of cases) {
      await render(selection);
      expect(title()?.textContent?.trim()).toBe(`Transazioni · ${label}`);
      await respond(page(0, 0));
      fixture.destroy();
    }
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

  it('il link apre la stessa selezione in Movimenti', async () => {
    await render();
    await respond(page(25, 312));

    const link = host().querySelector<HTMLAnchorElement>('a[href*="/transactions"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('Apri in Movimenti →');
    expect(link!.getAttribute('href')).toContain('merchantIds=m-1');
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
  });

  it('senza righe lo dice', async () => {
    await render();
    await respond(page(0, 0));

    expect(text()).toContain('Nessuna transazione per questa selezione.');
    expect(host().querySelector('app-transactions-table')).toBeNull();
  });

  it('il pulsante chiudi emette closed', async () => {
    await render();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);

    host().querySelector<HTMLButtonElement>('button[aria-label="Chiudi dettaglio"]')!.click();

    expect(closed).toBe(1);
    await finish();
  });

  it('cambiando selezione in volo, vince l’ultima', async () => {
    await render();
    const [first] = pending();

    fixture.componentRef.setInput('selection', {
      kind: 'merchant',
      merchantId: 'm-2',
      name: 'CARREFOUR'
    } satisfies AnalyticsSelectionValue);
    fixture.componentRef.setInput('query', { ...EMPTY_QUERY, merchantIds: ['m-2'] });
    await settle();

    const [second] = pending().filter((request) => request !== first);
    expect(second.request.params.get('merchantIds')).toBe('m-2');
    second.flush(page(2, 2, 'CARREFOUR'));
    await settle();

    // La risposta vecchia, se mai arrivasse, non deve più toccare la vista.
    if (!first.cancelled) {
      first.flush(page(4, 4, 'ESSELUNGA'));
      await settle();
    }
    expect(first.cancelled).toBe(true);

    expect(title()?.textContent?.trim()).toBe('Transazioni · CARREFOUR');
    const rows = host().querySelectorAll('app-transactions-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('CARREFOUR');
  });

  it('ricaricando la stessa selezione, le righe di prima restano attenuate finché non arrivano le nuove', async () => {
    await render();
    await respond(page(2, 2, 'ESSELUNGA'));

    fixture.componentRef.setInput('query', { ...merchantQuery, search: 'bio' });
    await settle();

    const content = host().querySelector('.content');
    expect(content?.classList.contains('stale')).toBe(true);
    expect(content?.getAttribute('aria-busy')).toBe('true');
    expect(host().querySelectorAll('app-transactions-table tbody tr')).toHaveLength(2);

    await respond(page(3, 3, 'BIO'));

    expect(host().querySelector('.content.stale')).toBeNull();
    expect(host().querySelector('.content')?.getAttribute('aria-busy')).toBe('false');
    const rows = host().querySelectorAll('app-transactions-table tbody tr');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('BIO');
  });

  it('cambiando selezione, le righe della precedente spariscono fino alla nuova risposta', async () => {
    await render();
    await respond(page(25, 312, 'ESSELUNGA'));

    fixture.componentRef.setInput('selection', {
      kind: 'merchant',
      merchantId: 'm-2',
      name: 'CARREFOUR'
    } satisfies AnalyticsSelectionValue);
    fixture.componentRef.setInput('query', { ...EMPTY_QUERY, merchantIds: ['m-2'] });
    await settle();

    expect(text()).toContain('Caricamento in corso…');
    expect(text()).not.toContain('ESSELUNGA');
    expect(text()).not.toContain('Mostrate');
    expect(host().querySelector('app-transactions-table')).toBeNull();

    await respond(page(2, 2, 'CARREFOUR'));

    expect(text()).not.toContain('Caricamento in corso…');
    const rows = host().querySelectorAll('app-transactions-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('CARREFOUR');
  });

  it('a ogni nuova selezione porta in vista il pannello e ne mette a fuoco il titolo', async () => {
    await render();
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    scroll.mockClear();

    fixture.componentRef.setInput('selection', {
      kind: 'merchant',
      merchantId: 'm-2',
      name: 'CARREFOUR'
    } satisfies AnalyticsSelectionValue);
    await settle();
    // Il fuoco va altrove: alla selezione successiva deve tornare sul titolo.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).not.toBe(title());
    fixture.componentRef.setInput('selection', {
      kind: 'category',
      categoryId: 'cat-1',
      name: 'Alimentari'
    } satisfies AnalyticsSelectionValue);
    await settle();

    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(document.activeElement).toBe(title());
    expect(title()?.getAttribute('tabindex')).toBe('-1');
    await finish();
  });

  it('con revealOnInit spento non si porta in vista alla nascita, ma alla selezione successiva sì', async () => {
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    const before = document.activeElement;

    fixture = TestBed.createComponent(AnalyticsTransactions);
    fixture.componentRef.setInput('selection', merchantSelection);
    fixture.componentRef.setInput('query', merchantQuery);
    fixture.componentRef.setInput('revealOnInit', false);
    await settle();

    expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(before);
    expect(document.activeElement).not.toBe(title());

    fixture.componentRef.setInput('selection', {
      kind: 'merchant',
      merchantId: 'm-2',
      name: 'CARREFOUR'
    } satisfies AnalyticsSelectionValue);
    await settle();

    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(title());
    await finish();
  });
});
