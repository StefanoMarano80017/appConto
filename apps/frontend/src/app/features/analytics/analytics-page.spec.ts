import { HttpParams, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../core/api';
import { AnalyticsTimeline } from './analytics-timeline';
import { AnalyticsPage } from './analytics-page';
import { AnalyticsSelection } from './analytics-selection';
import { Analytics } from './analytics.model';
import { AnalyticsStore } from './analytics.store';

/** Sta al posto dell'esplorazione: qui interessa solo dove porta il collegamento. */
@Component({ selector: 'app-stub-transactions', template: '' })
class StubTransactionsPage {}

const analytics = (overrides: Partial<Analytics> = {}): Analytics => ({
  period: {
    from: '2026-01-01',
    to: '2026-12-31',
    firstTransactionDate: '2026-07-10',
    lastTransactionDate: '2026-07-11'
  },
  query: {
    from: '2026-01-01',
    to: '2026-12-31',
    types: [],
    categoryIds: [],
    merchantIds: [],
    classification: 'all',
    granularity: 'week'
  },
  overview: {
    income: 2000,
    expenses: 500,
    balance: 1500,
    withdrawals: -300,
    loans: -250,
    transfers: 0,
    other: 0,
    netMovement: 950
  },
  counts: { transactions: 4, merchants: 3, categories: 1 },
  byCategory: [
    {
      categoryId: 'cat-1',
      name: 'Alimentari',
      color: '#3f8f4f',
      amount: 500,
      transactionCount: 2,
      percentage: 100
    }
  ],
  byMerchant: [
    {
      merchantId: 'm-1',
      name: 'ESSELUNGA',
      category: 'Alimentari',
      amount: 300,
      transactionCount: 1,
      percentage: 60
    },
    {
      merchantId: 'm-2',
      name: 'CARREFOUR',
      category: 'Alimentari',
      amount: 200,
      transactionCount: 1,
      percentage: 40
    }
  ],
  timeline: {
    granularity: 'week',
    buckets: [
      {
        period: '2026-07-06',
        partial: false,
        income: 2000,
        expenses: 500,
        withdrawals: -300,
        loans: -250,
        transfers: 0,
        netMovement: 950
      }
    ]
  },
  loans: {
    lent: 250,
    transactionCount: 1,
    entries: [
      {
        id: 'l-1',
        bookingDate: '2026-07-05',
        description: 'PRESTITO A MARIO',
        merchant: 'PRESTITO A MARIO',
        amount: -250
      }
    ]
  },
  ...overrides
});

const empty = (): Analytics =>
  analytics({
    overview: {
      income: 0,
      expenses: 0,
      balance: 0,
      withdrawals: 0,
      loans: 0,
      transfers: 0,
      other: 0,
      netMovement: 0
    },
    counts: { transactions: 0, merchants: 0, categories: 0 },
    byCategory: [],
    byMerchant: [],
    timeline: { granularity: 'week', buckets: [] },
    loans: { lent: 0, transactionCount: 0, entries: [] }
  });

const RANGE = 'from=2026-01-01&to=2026-12-31';
/** Il passo chiude sempre la query string: viene aggiunto per ultimo. */
const STEP = 'granularity=week';
const PERIOD = `${RANGE}&${STEP}`;

describe('AnalyticsPage', () => {
  let fixture: ComponentFixture<AnalyticsPage>;
  let http: HttpTestingController;
  let store: AnalyticsStore;

  const text = (): string =>
    ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\./g, '');

  /** Come `text()`, ma ancorato a un contenitore: verifica che il contenuto sparisca davvero se manca. */
  const sectionText = (selector: string): string =>
    ((fixture.nativeElement as HTMLElement).querySelector(selector)?.textContent ?? '').replace(
      /\./g,
      ''
    );

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  /** Risponde alle richieste di contorno: categorie e merchant dei filtri. */
  const flushLookups = async (): Promise<void> => {
    for (const request of http.match(`${API_BASE_URL}/categories`)) {
      request.flush([{ id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' }]);
    }
    for (const request of http.match(`${API_BASE_URL}/merchants/summary`)) {
      request.flush([]);
    }
    await settle();
  };

  const flush = async (data: Analytics, query: string = PERIOD): Promise<void> => {
    const url = query === '' ? `${API_BASE_URL}/analytics` : `${API_BASE_URL}/analytics?${query}`;
    http.expectOne(url).flush(data);
    await settle();
    await flushLookups();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalyticsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'transactions', component: StubTransactionsPage }])
      ],
      // Una richiesta fallita è uno scenario da verificare, non un errore del test.
      rethrowApplicationErrors: false
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AnalyticsStore);
    store.resetFilters();
    store.setCustomRange('2026-01-01', '2026-12-31');

    fixture = TestBed.createComponent(AnalyticsPage);
  });

  afterEach(() => http.verify());

  it('mostra il caricamento e poi tutte le sezioni', async () => {
    await settle();
    expect(text()).toContain('Caricamento in corso');

    await flush(analytics());

    expect(text()).toContain('Andamento nel tempo');
    expect(text()).toContain('Spese per categoria');
    expect(text()).toContain('Merchant principali');
    expect(sectionText('app-analytics-loans')).toContain('Prestiti');
  });

  it('non rende il titolo di pagina a nessun livello: lo rende la shell', async () => {
    await settle();
    await flush(analytics());

    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelectorAll('h1').length).toBe(0);

    /*
     * La pagina non ripete il proprio titolo a nessun livello: «Analytics» lo
     * rende la fascia superiore come `h1`, leggendolo dal router. Prima questo
     * test pretendeva un `h2` «Analytics» dentro la pagina, che era
     * l'intestazione ormai ridondante col titolo della shell: toglierla rende
     * l'invariante più forte, non più debole — chi naviga per intestazioni
     * incontra il titolo della rotta una volta sola.
     */
    const intestazioni = Array.from(host.querySelectorAll('h1, h2, h3')).map(
      (elemento) => elemento.textContent ?? ''
    );
    expect(intestazioni.some((testo) => testo.includes('Analytics'))).toBe(false);
  });

  it('è una dashboard: non contiene più la tabella dei movimenti', async () => {
    await settle();
    await flush(analytics());

    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('app-transactions-table')).toBeNull();
    expect(host.querySelector('table')).toBeNull();
  });

  it('mostra i KPI, separando prelievi e prestiti dalle uscite', async () => {
    await settle();
    await flush(analytics());

    expect(sectionText('app-stat-card-grid')).toContain('Entrate');
    expect(text()).toContain('2000,00');
    expect(text()).toContain('Uscite');
    expect(text()).toContain('500,00');
    expect(sectionText('app-stat-card-grid')).toContain('Prelievi');
    // Ancorata al contenitore, non a `text()`: `analytics-merchants.html`
    // rende lo stesso «−300,00 €» (ESSELUNGA, v. fixture sopra) altrove
    // nella pagina — su `text()` l'asserzione passerebbe anche se questa
    // card sparisse o mostrasse il valore sbagliato. U+2212, non il
    // trattino ASCII: le card KPI passano ora da `Amount`, che normalizza
    // il segno come fa altrove (v. `amount.spec.ts`).
    expect(sectionText('app-stat-card-grid')).toContain('−300,00');
  });

  it('chiede al backend il periodo selezionato', async () => {
    await settle();
    await flush(analytics());

    store.selectPreset('all');
    await settle();
    await flush(analytics(), STEP);

    expect(store.selectedPeriodLabel()).toBe('Tutto');
  });

  it('un cambio di filtro aggiorna tutte le sezioni', async () => {
    await settle();
    await flush(analytics());
    expect(text()).toContain('CARREFOUR');

    store.toggleCategory('cat-1');
    await settle();
    await flush(
      analytics({
        overview: { ...analytics().overview, expenses: 300 },
        counts: { transactions: 1, merchants: 1, categories: 1 },
        byMerchant: [
          {
            merchantId: 'm-1',
            name: 'ESSELUNGA',
            category: 'Alimentari',
            amount: 300,
            transactionCount: 1,
            percentage: 100
          }
        ]
      }),
      `${RANGE}&categoryIds=cat-1&${STEP}`
    );

    expect(text()).not.toContain('CARREFOUR');
    expect(text()).toContain('300,00');
  });

  it('mentre un nuovo filtro è in volo il contenuto precedente resta a schermo', async () => {
    await settle();
    await flush(analytics());

    store.toggleCategory('cat-1');
    await settle();

    // La richiesta è in volo: httpResource ha già azzerato il proprio valore,
    // ma la latch di `data` deve trattenere quello precedente — niente più
    // sparizione del grafico, e il ramo del primo caricamento non deve
    // prendere il suo posto.
    expect(sectionText('app-analytics-timeline')).toContain('Andamento nel tempo');
    expect(text()).not.toContain('Caricamento in corso');

    await flush(analytics(), `${RANGE}&categoryIds=cat-1&${STEP}`);
  });

  it('spiega che non ci sono dati invece di mostrare sezioni vuote', async () => {
    await settle();
    await flush(empty());

    expect(text()).toContain('Nessun dato disponibile per il periodo selezionato');
    expect(text()).not.toContain('Andamento nel tempo');
    expect(sectionText('app-stat-card-grid')).toContain('Entrate');
  });

  it('mostra l\'errore restituito dal backend', async () => {
    await settle();
    http
      .expectOne(`${API_BASE_URL}/analytics?${PERIOD}`)
      .flush(
        { error: 'Intervallo non valido: la data iniziale è successiva a quella finale.' },
        { status: 400, statusText: 'Bad Request' }
      );
    await settle();
    await flushLookups();

    expect(text()).toContain('Intervallo non valido');
  });
});

describe('AnalyticsPage: deep link verso l\'esplorazione', () => {
  let fixture: ComponentFixture<AnalyticsPage>;
  let http: HttpTestingController;
  let store: AnalyticsStore;

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const load = async (data: Analytics = analytics()): Promise<void> => {
    await settle();
    http.expectOne(`${API_BASE_URL}/analytics?${PERIOD}`).flush(data);
    await settle();
    for (const request of http.match(`${API_BASE_URL}/categories`)) {
      request.flush([{ id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' }]);
    }
    for (const request of http.match(`${API_BASE_URL}/merchants/summary`)) {
      request.flush([]);
    }
    await settle();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalyticsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'transactions', component: StubTransactionsPage }])
      ]
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AnalyticsStore);
    store.resetFilters();
    store.setCustomRange('2026-01-01', '2026-12-31');

    fixture = TestBed.createComponent(AnalyticsPage);
  });

  afterEach(() => http.verify());

  it('i prestiti portano ai movimenti di tipo LOAN', async () => {
    await load();
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      'app-analytics-loans .explore a.movements'
    );

    expect(link?.getAttribute('href')).toContain('types=LOAN');
    expect(link?.getAttribute('href')).toContain('from=2026-01-01');
  });

  it('il collegamento generale porta almeno il periodo', async () => {
    await load();
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      '.explore.all a'
    );

    expect(link?.getAttribute('href')).toContain('/transactions');
    expect(link?.getAttribute('href')).toContain('from=2026-01-01');
    expect(link?.getAttribute('href')).toContain('to=2026-12-31');
  });
});

/*
 * Un click su un elemento del grafico non porta più a Movimenti: apre sotto i
 * grafici il pannello con le transazioni di quell'elemento. Ogni test controlla
 * entrambe le metà: l'URL resta quello di Analytics, e la richiesta del
 * pannello porta i criteri giusti.
 */
describe('AnalyticsPage: le transazioni della selezione', () => {
  let fixture: ComponentFixture<AnalyticsPage>;
  let http: HttpTestingController;
  let store: AnalyticsStore;
  let selection: AnalyticsSelection;
  let router: Router;
  let startUrl: string;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const panel = (): HTMLElement | null => host().querySelector('app-analytics-transactions');
  const panelTitle = (): string => panel()?.querySelector('h2')?.textContent ?? '';

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const flushLookups = async (): Promise<void> => {
    for (const request of http.match(`${API_BASE_URL}/categories`)) {
      request.flush([{ id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' }]);
    }
    for (const request of http.match(`${API_BASE_URL}/merchants/summary`)) {
      request.flush([]);
    }
    await settle();
  };

  const load = async (data: Analytics = analytics(), query: string = PERIOD): Promise<void> => {
    await settle();
    http.expectOne(`${API_BASE_URL}/analytics?${query}`).flush(data);
    await settle();
    await flushLookups();
  };

  /** Le richieste del pannello ancora aperte. */
  const panelRequests = (): TestRequest[] =>
    http.match((request) => request.url === `${API_BASE_URL}/transactions`);

  /** L'unica richiesta del pannello in volo: risponde con una pagina vuota e ne restituisce i parametri. */
  const panelRequest = async (): Promise<HttpParams> => {
    const requests = panelRequests();
    expect(requests.length).toBe(1);
    const [request] = requests;
    request!.flush({
      items: [],
      pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 }
    });
    await settle();

    return request!.request.params;
  };

  const click = async (selector: string): Promise<void> => {
    host().querySelector<HTMLElement>(selector)?.click();
    await settle();
    await settle();
  };

  // La scheda apre sul grafico: le righe cliccabili stanno nella Lista.
  const showCategoryList = async (): Promise<void> => {
    Array.from(
      host().querySelectorAll<HTMLButtonElement>('app-analytics-categories app-choice-group button')
    )
      .find((button) => button.getAttribute('aria-label') === 'Lista')
      ?.click();
    await settle();
  };

  /** Il tooltip della timeline chiede le transazioni di un bucket settimanale. */
  const requestBucket = async (): Promise<void> => {
    const timeline = fixture.debugElement.query(By.directive(AnalyticsTimeline))
      .componentInstance as AnalyticsTimeline;
    timeline.transactionsRequested.emit({
      granularity: 'week',
      period: '2026-07-06',
      range: { from: '2026-07-06', to: '2026-07-12' },
      label: 'settimana del 6 luglio'
    });
    await settle();
    await settle();
  };

  beforeEach(async () => {
    // jsdom non implementa scrollIntoView, che il pannello chiama all'apertura.
    Element.prototype.scrollIntoView = vi.fn();

    await TestBed.configureTestingModule({
      imports: [AnalyticsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'transactions', component: StubTransactionsPage }])
      ]
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AnalyticsStore);
    selection = TestBed.inject(AnalyticsSelection);
    router = TestBed.inject(Router);
    store.resetFilters();
    store.setCustomRange('2026-01-01', '2026-12-31');
    startUrl = router.url;

    fixture = TestBed.createComponent(AnalyticsPage);
  });

  afterEach(() => {
    http.verify();
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it('senza selezione il pannello non c\'è', async () => {
    await load();

    expect(panel()).toBeNull();
    expect(panelRequests()).toEqual([]);
  });

  it('una categoria apre le sue transazioni nel pannello, senza navigare', async () => {
    await load();
    await showCategoryList();
    await click('app-analytics-categories .row');

    expect(router.url).toBe(startUrl);
    expect(panel()).not.toBeNull();
    const params = await panelRequest();
    expect(params.get('categoryIds')).toBe('cat-1');
    expect(params.get('types')).toBe('EXPENSE');
    expect(params.get('from')).toBe('2026-01-01');
    expect(params.get('to')).toBe('2026-12-31');
    expect(panelTitle()).toContain('Alimentari');
  });

  it('una categoria senza nome apre le transazioni da classificare', async () => {
    await load(
      analytics({
        byCategory: [
          {
            categoryId: null,
            name: 'Senza categoria',
            color: null,
            amount: 40,
            transactionCount: 1,
            percentage: 100
          }
        ]
      })
    );
    await showCategoryList();
    await click('app-analytics-categories .row');

    expect(router.url).toBe(startUrl);
    const params = await panelRequest();
    expect(params.get('classification')).toBe('unclassified');
    expect(params.has('categoryIds')).toBe(false);
    expect(params.get('from')).toBe('2026-01-01');
    expect(panelTitle()).toContain('Da classificare');
  });

  it('un merchant apre le proprie transazioni', async () => {
    await load();
    await click('app-analytics-merchants .link');

    expect(router.url).toBe(startUrl);
    const params = await panelRequest();
    expect(params.get('merchantIds')).toBe('m-1');
    expect(params.get('from')).toBe('2026-01-01');
    expect(panelTitle()).toContain('ESSELUNGA');
  });

  it('il tooltip apre le transazioni del bucket, mantenendo i filtri attivi', async () => {
    await load();
    store.toggleType('EXPENSE');
    await load(analytics(), `${RANGE}&types=EXPENSE&${STEP}`);

    await requestBucket();

    expect(router.url).toBe(startUrl);
    const params = await panelRequest();
    // Il range del bucket sostituisce il periodo dello store; i filtri restano.
    expect(params.get('from')).toBe('2026-07-06');
    expect(params.get('to')).toBe('2026-07-12');
    expect(params.get('types')).toBe('EXPENSE');
    expect(panelTitle()).toContain('settimana del 6 luglio');
  });

  it('la richiesta del pannello porta periodo e filtri dello store, con pagina e ordinamento predefiniti', async () => {
    store.toggleType('EXPENSE');
    await load(analytics(), `${RANGE}&types=EXPENSE&${STEP}`);

    await click('app-analytics-merchants .link');

    const params = await panelRequest();
    expect(params.get('from')).toBe('2026-01-01');
    expect(params.get('to')).toBe('2026-12-31');
    expect(params.get('types')).toBe('EXPENSE');
    expect(params.get('merchantIds')).toBe('m-1');
    // Pagina 1, 25 righe, bookingDate desc: tutti predefiniti, quindi assenti.
    expect(params.keys().sort()).toEqual(['from', 'merchantIds', 'to', 'types']);
  });

  it('il pannello sta fra categorie e merchant e i prestiti', async () => {
    await load();
    await click('app-analytics-merchants .link');
    await panelRequest();

    const tutti = [...host().querySelectorAll('*')];
    const posizione = (elemento: Element | null): number => tutti.indexOf(elemento!);

    expect(panel()).not.toBeNull();
    expect(posizione(host().querySelector('.columns'))).toBeLessThan(posizione(panel()));
    // Dopo l'ultimo figlio delle colonne, non dentro di esse.
    expect(host().querySelector('.columns')?.contains(panel())).toBe(false);
    expect(posizione(panel())).toBeLessThan(posizione(host().querySelector('app-analytics-loans')));
  });

  it('un cambio di filtro ricarica il pannello con i nuovi criteri', async () => {
    await load();
    await click('app-analytics-merchants .link');
    await panelRequest();

    store.toggleType('INCOME');
    await load(analytics(), `${RANGE}&types=INCOME&${STEP}`);

    expect(panel()).not.toBeNull();
    const params = await panelRequest();
    expect(params.get('types')).toBe('INCOME');
    expect(params.get('merchantIds')).toBe('m-1');
  });

  it('cambiare il passo chiude la selezione di un bucket solo all’arrivo dei nuovi dati', async () => {
    await load();
    await requestBucket();
    await panelRequest();

    store.setGranularity('month');
    await settle();

    // I dati a schermo sono ancora quelli settimanali: lì il bucket esiste.
    expect(panel()).not.toBeNull();
    expect(selection.selection()).not.toBeNull();

    await load(
      analytics({
        timeline: {
          granularity: 'month',
          buckets: [{ ...analytics().timeline.buckets[0]!, period: '2026-07' }]
        }
      }),
      `${RANGE}&granularity=month`
    );

    expect(panel()).toBeNull();
    expect(selection.selection()).toBeNull();
  });

  it('un elemento sparito dai nuovi dati chiude il pannello', async () => {
    await load();
    await showCategoryList();
    await click('app-analytics-categories .row');
    await panelRequest();

    store.toggleType('INCOME');
    await load(
      analytics({
        byCategory: [
          {
            categoryId: 'cat-2',
            name: 'Casa',
            color: '#3f4f8f',
            amount: 100,
            transactionCount: 1,
            percentage: 100
          }
        ]
      }),
      `${RANGE}&types=INCOME&${STEP}`
    );

    expect(panel()).toBeNull();
    expect(selection.selection()).toBeNull();
    // La richiesta partita col nuovo filtro, prima della risposta Analytics, è annullata.
    expect(panelRequests().map((request) => request.cancelled)).toEqual([true]);
  });

  it('con dati vuoti il pannello sparisce e la selezione si chiude', async () => {
    await load();
    await click('app-analytics-merchants .link');
    await panelRequest();

    store.toggleType('INCOME');
    await load(
      // L'elemento c'è ancora: a chiudere è il dataset vuoto, non la sua assenza.
      { ...empty(), byMerchant: analytics().byMerchant },
      `${RANGE}&types=INCOME&${STEP}`
    );

    expect(panel()).toBeNull();
    expect(selection.selection()).toBeNull();
    // La richiesta partita col nuovo filtro, prima della risposta Analytics, è annullata.
    expect(panelRequests().map((request) => request.cancelled)).toEqual([true]);
  });

  it('la selezione sopravvive all’uscita e al rientro nella pagina', async () => {
    await load();
    await click('app-analytics-merchants .link');
    await panelRequest();

    fixture.destroy();
    fixture = TestBed.createComponent(AnalyticsPage);
    await settle();

    // Senza dati non si può dire se l'elemento esiste ancora: si aspetta.
    expect(selection.selection()).not.toBeNull();

    await load();

    expect(panel()).not.toBeNull();
    expect(panelTitle()).toContain('ESSELUNGA');
    await panelRequest();
  });

  it('la prima selezione porta in vista il pannello', async () => {
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    await load();
    await click('app-analytics-merchants .link');
    await panelRequest();

    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(panel()?.querySelector('h2'));
  });

  it('rientrando con una selezione il pannello non ruba scroll e focus, una nuova selezione sì', async () => {
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    await load();
    await click('app-analytics-merchants .link');
    await panelRequest();

    fixture.destroy();
    (document.activeElement as HTMLElement | null)?.blur();
    scroll.mockClear();
    fixture = TestBed.createComponent(AnalyticsPage);
    await load();
    await panelRequest();

    // Il rientro non è una nuova selezione: il pannello c'è, ma resta dov'è.
    expect(panel()).not.toBeNull();
    expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(panel()?.querySelector('h2'));

    host().querySelectorAll<HTMLElement>('app-analytics-merchants .link')[1]?.click();
    await settle();
    await settle();
    expect((await panelRequest()).get('merchantIds')).toBe('m-2');

    expect(scroll).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(panel()?.querySelector('h2'));
  });

  it('il pulsante chiudi toglie il pannello', async () => {
    await load();
    await click('app-analytics-merchants .link');
    await panelRequest();

    await click('app-analytics-transactions button[aria-label="Chiudi dettaglio"]');

    expect(selection.selection()).toBeNull();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(host().querySelector('h2'));
  });
});
