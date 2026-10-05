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
import { AnalyticsCategories } from './analytics-categories';
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

/** Le richieste aperte della tabella delle transazioni, risposte con una pagina vuota. */
const flushPanel = (): void => {
  const http = TestBed.inject(HttpTestingController);
  for (const request of http.match((candidate) => candidate.url === `${API_BASE_URL}/transactions`)) {
    if (!request.cancelled) {
      request.flush({ items: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
    }
  }
};

/**
 * Risponde alla richiesta principale dell'analisi, che deve essere una sola, e
 * con gli stessi dati a quelle del cross-filter eventualmente in volo
 * (categorie o merchant senza il proprio filtro). Qui conta la richiesta
 * principale: il cross-filter ha la sua describe in fondo al file.
 */
const flushAnalytics = (data: Analytics, query: string): void => {
  const http = TestBed.inject(HttpTestingController);
  const url = query === '' ? `${API_BASE_URL}/analytics` : `${API_BASE_URL}/analytics?${query}`;
  const pending = http
    .match((candidate) => candidate.url === `${API_BASE_URL}/analytics`)
    .filter((request) => !request.cancelled);

  expect(pending.filter((request) => request.request.urlWithParams === url).length).toBe(1);
  for (const request of pending) {
    request.flush(data);
  }
};

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

  /**
   * Risponde alle richieste di contorno: categorie e merchant dei filtri, e la
   * tabella delle transazioni, che con dei dati c'è sempre (qui non la si
   * guarda: ha la sua describe più sotto).
   */
  const flushLookups = async (): Promise<void> => {
    for (const request of http.match(`${API_BASE_URL}/categories`)) {
      request.flush([{ id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' }]);
    }
    for (const request of http.match(`${API_BASE_URL}/merchants/summary`)) {
      request.flush([]);
    }
    await settle();
    // La richiesta della tabella parte al giro dopo la nascita del pannello.
    await settle();
    flushPanel();
    await settle();
  };

  const flush = async (data: Analytics, query: string = PERIOD): Promise<void> => {
    flushAnalytics(data, query);
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
    // La richiesta della tabella parte al giro dopo la nascita del pannello.
    await settle();
    flushPanel();
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
 * La tabella delle transazioni c'è sempre, appena sotto l'andamento, e mostra
 * le transazioni dei filtri dell'analisi: nient'altro. Un click su un grafico
 * non apre una vista a parte: cambia i filtri, esattamente come farebbe chi li
 * tocca nella barra, e da lì si aggiornano insieme grafici e tabella. I filtri
 * cambiano solo per un gesto: nessun cambio di passo o di dati li tocca da sé.
 * Ogni test guarda lo store e la richiesta del pannello, che è ciò che decide
 * quali righe si vedono.
 */
describe('AnalyticsPage: i grafici modificano i filtri', () => {
  let fixture: ComponentFixture<AnalyticsPage>;
  let http: HttpTestingController;
  let store: AnalyticsStore;
  let router: Router;
  let startUrl: string;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const panel = (): HTMLElement | null => host().querySelector('app-analytics-transactions');
  const panelTitle = (): string => panel()?.querySelector('h2')?.textContent?.trim() ?? '';

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
    flushAnalytics(data, query);
    await settle();
    await flushLookups();
  };

  /** Le richieste del pannello ancora attese: quelle annullate non arriveranno mai a schermo. */
  const panelRequests = (): TestRequest[] =>
    http
      .match((request) => request.url === `${API_BASE_URL}/transactions`)
      .filter((request) => !request.cancelled);

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

  const rowPressed = (selector: string): string | null | undefined =>
    host().querySelector(selector)?.getAttribute('aria-pressed');

  // La scheda apre sul grafico: le righe cliccabili stanno nella Lista.
  const showCategoryList = async (): Promise<void> => {
    Array.from(
      host().querySelectorAll<HTMLButtonElement>('app-analytics-categories app-choice-group button')
    )
      .find((button) => button.getAttribute('aria-label') === 'Lista')
      ?.click();
    await settle();
  };

  /** Il tooltip della timeline chiede di filtrare su un bucket settimanale. */
  const requestBucket = async (): Promise<void> => {
    const timeline = fixture.debugElement.query(By.directive(AnalyticsTimeline))
      .componentInstance as AnalyticsTimeline;
    timeline.periodSelected.emit({
      granularity: 'week',
      period: '2026-07-06',
      range: { from: '2026-07-06', to: '2026-07-12' },
      label: 'settimana del 6 luglio'
    });
    await settle();
    await settle();
  };

  /** Una fetta della ciambella: stessa uscita della riga della Lista. */
  const selectSlice = async (categoryId: string | null): Promise<void> => {
    const categories = fixture.debugElement.query(By.directive(AnalyticsCategories))
      .componentInstance as AnalyticsCategories;
    categories.categorySelected.emit(categoryId);
    await settle();
    await settle();
  };

  const unclassified = (): Analytics =>
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
    });

  beforeEach(async () => {
    // jsdom non implementa scrollIntoView: lo stub serve a verificare che nessuno lo chiami.
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

  it('senza nessun click mostra le transazioni del periodo, fra l’andamento e le colonne', async () => {
    await load();

    expect(panel()).not.toBeNull();
    expect(panelTitle()).toBe('Transazioni del periodo');
    // Non c'è più niente da «togliere»: la tabella segue solo i filtri.
    expect(panel()?.textContent).not.toContain('Mostra tutto');

    const tutti = [...host().querySelectorAll('*')];
    const posizione = (elemento: Element | null): number => tutti.indexOf(elemento!);
    expect(posizione(host().querySelector('app-analytics-timeline'))).toBeLessThan(
      posizione(panel())
    );
    expect(posizione(panel())).toBeLessThan(posizione(host().querySelector('.columns')));
    // Fra i due, non dentro: né nella timeline né nelle colonne.
    expect(host().querySelector('app-analytics-timeline')?.contains(panel())).toBe(false);
    expect(host().querySelector('.columns')?.contains(panel())).toBe(false);

    const params = await panelRequest();
    // Pagina 1, 25 righe, bookingDate desc: tutti predefiniti, quindi assenti.
    expect(params.keys().sort()).toEqual(['from', 'to']);
    expect(params.get('from')).toBe('2026-01-01');
    expect(params.get('to')).toBe('2026-12-31');
  });

  it('la richiesta della tabella porta periodo e filtri dello store, e nient’altro', async () => {
    store.toggleType('EXPENSE');
    store.toggleCategory('cat-1');
    await load(analytics(), `${RANGE}&types=EXPENSE&categoryIds=cat-1&${STEP}`);

    const params = await panelRequest();
    expect(params.get('from')).toBe('2026-01-01');
    expect(params.get('to')).toBe('2026-12-31');
    expect(params.get('types')).toBe('EXPENSE');
    expect(params.get('categoryIds')).toBe('cat-1');
    expect(params.has('merchantIds')).toBe(false);
    expect(params.has('classification')).toBe(false);
  });

  it('con dati vuoti la tabella non c’è', async () => {
    await load(empty());

    expect(panel()).toBeNull();
    expect(panelRequests()).toEqual([]);
  });

  it('il tooltip porta il periodo dell’analisi sul bucket, tenendo gli altri filtri', async () => {
    store.selectPreset('all');
    store.toggleType('EXPENSE');
    await load(analytics(), `types=EXPENSE&${STEP}`);
    await panelRequest();

    await requestBucket();

    // È il periodo dei filtri a cambiare, come se lo si fosse scelto a mano.
    expect(store.preset()).toBe('custom');
    expect(store.dateRange()).toEqual({ from: '2026-07-06', to: '2026-07-12' });
    expect(store.filters().types).toEqual(['EXPENSE']);
    expect(router.url).toBe(startUrl);

    await load(analytics(), 'from=2026-07-06&to=2026-07-12&types=EXPENSE&granularity=day');
    const params = await panelRequest();
    expect(params.get('from')).toBe('2026-07-06');
    expect(params.get('to')).toBe('2026-07-12');
    expect(params.get('types')).toBe('EXPENSE');
    expect(panelTitle()).toBe('Transazioni del periodo');
  });

  it('una riga della Lista attiva e disattiva il filtro della categoria', async () => {
    await load();
    await panelRequest();
    await showCategoryList();

    await click('app-analytics-categories .row');

    expect(store.filters().categoryIds).toEqual(['cat-1']);
    expect(router.url).toBe(startUrl);
    await load(analytics(), `${RANGE}&categoryIds=cat-1&${STEP}`);
    let params = await panelRequest();
    expect(params.get('categoryIds')).toBe('cat-1');
    // La categoria è un filtro come gli altri: nessun tipo aggiunto di nascosto.
    expect(params.has('types')).toBe(false);
    expect(params.get('from')).toBe('2026-01-01');
    expect(panelTitle()).toBe('Transazioni del periodo');
    // La riga dice che quella categoria è fra i filtri.
    expect(rowPressed('app-analytics-categories .row')).toBe('true');

    // Un secondo click sulla stessa categoria la toglie.
    await click('app-analytics-categories .row');

    expect(store.filters().categoryIds).toEqual([]);
    await load();
    params = await panelRequest();
    expect(params.has('categoryIds')).toBe(false);
    expect(rowPressed('app-analytics-categories .row')).toBe('false');
  });

  it('una fetta della ciambella fa lo stesso della riga', async () => {
    await load();
    await panelRequest();

    await selectSlice('cat-1');

    expect(store.filters().categoryIds).toEqual(['cat-1']);
    await load(analytics(), `${RANGE}&categoryIds=cat-1&${STEP}`);
    const params = await panelRequest();
    expect(params.get('categoryIds')).toBe('cat-1');
    expect(params.has('types')).toBe(false);

    await selectSlice('cat-1');

    expect(store.filters().categoryIds).toEqual([]);
    await load();
    await panelRequest();
  });

  it('«Da classificare» alterna il filtro di classificazione', async () => {
    await load(unclassified());
    await panelRequest();
    await showCategoryList();

    await click('app-analytics-categories .row');

    expect(store.filters().classification).toBe('unclassified');
    expect(store.filters().categoryIds).toEqual([]);
    await load(unclassified(), `${RANGE}&classification=unclassified&${STEP}`);
    const params = await panelRequest();
    expect(params.get('classification')).toBe('unclassified');
    expect(params.has('categoryIds')).toBe(false);
    expect(params.has('types')).toBe(false);
    expect(rowPressed('app-analytics-categories .row')).toBe('true');

    await click('app-analytics-categories .row');

    expect(store.filters().classification).toBe('all');
    await load(unclassified());
    expect((await panelRequest()).has('classification')).toBe(false);
  });

  it('un merchant attiva e disattiva il proprio filtro, senza lasciare la pagina', async () => {
    await load();
    await panelRequest();

    await click('app-analytics-merchants .link');

    expect(store.filters().merchantIds).toEqual(['m-1']);
    expect(router.url).toBe(startUrl);
    await load(analytics(), `${RANGE}&merchantIds=m-1&${STEP}`);
    const params = await panelRequest();
    expect(params.get('merchantIds')).toBe('m-1');
    expect(params.get('from')).toBe('2026-01-01');
    expect(rowPressed('app-analytics-merchants .link')).toBe('true');

    await click('app-analytics-merchants .link');

    expect(store.filters().merchantIds).toEqual([]);
    expect(router.url).toBe(startUrl);
    await load();
    expect((await panelRequest()).has('merchantIds')).toBe(false);
  });

  it('filtrare su una settimana porta il passo ai giorni', async () => {
    await load();
    await panelRequest();

    await requestBucket();

    expect(store.granularity()).toBe('day');
    // La richiesta successiva dell'analisi chiede già i giorni.
    await load(analytics(), 'from=2026-07-06&to=2026-07-12&granularity=day');
    await panelRequest();
  });

  it('filtrare su un mese porta il passo ai giorni', async () => {
    await load();
    await panelRequest();

    const timeline = fixture.debugElement.query(By.directive(AnalyticsTimeline))
      .componentInstance as AnalyticsTimeline;
    timeline.periodSelected.emit({
      granularity: 'month',
      period: '2026-02',
      range: { from: '2026-02-01', to: '2026-02-28' },
      label: 'febbraio 2026'
    });
    await settle();
    await settle();

    expect(store.granularity()).toBe('day');
    await load(analytics(), 'from=2026-02-01&to=2026-02-28&granularity=day');
    await panelRequest();
  });

  it('cambiare il passo non tocca né i filtri né il periodo', async () => {
    store.toggleCategory('cat-1');
    await load(analytics(), `${RANGE}&categoryIds=cat-1&${STEP}`);
    await panelRequest();
    const filters = store.filters();
    const range = store.dateRange();

    store.setGranularity('month');
    await load(
      analytics({
        timeline: {
          granularity: 'month',
          buckets: [{ ...analytics().timeline.buckets[0]!, period: '2026-07' }]
        }
      }),
      `${RANGE}&categoryIds=cat-1&granularity=month`
    );

    expect(store.filters()).toEqual(filters);
    expect(store.dateRange()).toEqual(range);
    expect(store.preset()).toBe('custom');
    // Il passo non è un criterio della tabella: nessuna nuova richiesta.
    expect(panelRequests()).toEqual([]);
    expect(panelTitle()).toBe('Transazioni del periodo');
  });

  it('un cambio di filtro dallo store ricarica la tabella', async () => {
    await load();
    await panelRequest();

    store.toggleType('INCOME');
    await load(analytics(), `${RANGE}&types=INCOME&${STEP}`);

    expect(panel()).not.toBeNull();
    const params = await panelRequest();
    expect(params.get('types')).toBe('INCOME');
    expect(params.get('from')).toBe('2026-01-01');
    expect(panelTitle()).toBe('Transazioni del periodo');
  });

  it('un click sui grafici non sposta la pagina né il focus', async () => {
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    (document.activeElement as HTMLElement | null)?.blur();
    const before = document.activeElement;

    await load();
    await panelRequest();
    await showCategoryList();
    await click('app-analytics-categories .row');
    await load(analytics(), `${RANGE}&categoryIds=cat-1&${STEP}`);
    await panelRequest();
    await requestBucket();
    await load(analytics(), 'from=2026-07-06&to=2026-07-12&categoryIds=cat-1&granularity=day');
    await panelRequest();

    expect(scroll).not.toHaveBeenCalled();
    // Il click sulla riga lascia il focus dov'era il click, o sul body: mai sul titolo della tabella.
    expect(document.activeElement).not.toBe(panel()?.querySelector('h2'));
    expect([before, host().querySelector('app-analytics-categories .row')]).toContain(
      document.activeElement
    );
  });
});

/*
 * Cross-filter: ogni ripartizione ignora il filtro della propria dimensione e
 * rispetta tutti gli altri. Filtrata una categoria, la ciambella deve ancora
 * mostrare le altre — attenuate — per avere qualcosa con cui confrontarla;
 * lo stesso per i merchant. KPI, andamento, prestiti e tabella restano sulla
 * query completa. La richiesta in più parte solo quando serve: senza filtri
 * della dimensione, la sezione legge la risposta principale.
 */
describe('AnalyticsPage: categorie e merchant ignorano il proprio filtro', () => {
  let fixture: ComponentFixture<AnalyticsPage>;
  let http: HttpTestingController;
  let store: AnalyticsStore;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const sectionText = (selector: string): string =>
    (host().querySelector(selector)?.textContent ?? '').replace(/\./g, '');

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const ANALYTICS = `${API_BASE_URL}/analytics`;

  /** Le richieste dell'analisi ancora attese, tolte dalla coda: il test deve risponderle tutte. */
  const analyticsRequests = (): TestRequest[] =>
    http.match((request) => request.url === ANALYTICS).filter((request) => !request.cancelled);

  const byQuery = (requests: TestRequest[], query: string): TestRequest => {
    const found = requests.filter(
      (request) => request.request.urlWithParams === `${ANALYTICS}?${query}`
    );
    expect(found.length).toBe(1);

    return found[0]!;
  };

  const flushLookups = async (): Promise<void> => {
    for (const request of http.match(`${API_BASE_URL}/categories`)) {
      request.flush([{ id: 'cat-1', name: 'Alimentari', color: '#3f8f4f' }]);
    }
    for (const request of http.match(`${API_BASE_URL}/merchants/summary`)) {
      request.flush([]);
    }
    await settle();
    // La richiesta della tabella parte al giro dopo la nascita del pannello.
    await settle();
    flushPanel();
    await settle();
  };

  /** Il primo caricamento, senza filtri: una sola richiesta dell'analisi. */
  const load = async (): Promise<void> => {
    await settle();
    const requests = analyticsRequests();
    expect(requests.length).toBe(1);
    byQuery(requests, PERIOD).flush(withTwoCategories());
    await settle();
    await flushLookups();
  };

  /** Risponde alla richiesta principale e a quella senza il filtro della dimensione. */
  const answer = async (main: string, cross: Analytics | 'error'): Promise<HttpParams> => {
    const requests = analyticsRequests();
    expect(requests.length).toBe(2);
    byQuery(requests, main).flush(narrowed());
    const crossRequest = byQuery(requests, PERIOD);
    if (cross === 'error') {
      crossRequest.flush(
        { error: 'Errore interno' },
        { status: 500, statusText: 'Internal Server Error' }
      );
    } else {
      crossRequest.flush(cross);
    }
    await settle();
    flushPanel();
    await settle();

    return crossRequest.request.params;
  };

  const click = async (selector: string): Promise<void> => {
    host().querySelector<HTMLElement>(selector)?.click();
    await settle();
    await settle();
  };

  const showCategoryList = async (): Promise<void> => {
    Array.from(
      host().querySelectorAll<HTMLButtonElement>('app-analytics-categories app-choice-group button')
    )
      .find((button) => button.getAttribute('aria-label') === 'Lista')
      ?.click();
    await settle();
  };

  const rows = (selector: string): { name: string; pressed: string | null }[] =>
    Array.from(host().querySelectorAll(selector)).map((row) => ({
      name: (row.getAttribute('aria-label') ?? '').replace('Filtra per ', ''),
      pressed: row.getAttribute('aria-pressed')
    }));

  /** Il periodo intero: due categorie di spesa. */
  const withTwoCategories = (): Analytics =>
    analytics({
      byCategory: [
        { ...analytics().byCategory[0]!, amount: 300, percentage: 60 },
        {
          categoryId: 'cat-2',
          name: 'Trasporti',
          color: '#1f5fa8',
          amount: 200,
          transactionCount: 1,
          percentage: 40
        }
      ]
    });

  /** La risposta principale dopo aver filtrato «Alimentari» o ESSELUNGA: resta solo quella. */
  const narrowed = (): Analytics =>
    analytics({
      overview: { ...analytics().overview, expenses: 300 },
      counts: { transactions: 1, merchants: 1, categories: 1 },
      byCategory: [{ ...analytics().byCategory[0]!, amount: 300, percentage: 100 }],
      byMerchant: [{ ...analytics().byMerchant[0]!, percentage: 100 }]
    });

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

  it('senza filtri parte una sola richiesta dell’analisi, e le sezioni leggono quella', async () => {
    await load();

    expect(analyticsRequests()).toEqual([]);
    expect(rows('app-analytics-merchants .link').map((row) => row.name)).toEqual([
      'ESSELUNGA',
      'CARREFOUR'
    ]);
    expect(sectionText('app-analytics-categories')).toContain('Spese per categoria');
  });

  it('filtrata una categoria, le categorie arrivano dalla richiesta senza il loro filtro', async () => {
    await load();
    await showCategoryList();

    await click('app-analytics-categories .row');
    const params = await answer(`${RANGE}&categoryIds=cat-1&${STEP}`, withTwoCategories());

    expect(params.has('categoryIds')).toBe(false);
    expect(params.has('classification')).toBe(false);
    // Entrambe le categorie restano a schermo, quella filtrata è premuta.
    expect(rows('app-analytics-categories .row')).toEqual([
      { name: 'Alimentari', pressed: 'true' },
      { name: 'Trasporti', pressed: 'false' }
    ]);
    // KPI e merchant seguono la query completa.
    expect(sectionText('app-stat-card-grid')).toContain('300,00');
    expect(sectionText('app-analytics-merchants')).not.toContain('CARREFOUR');
  });

  it('il filtro «da classificare» non entra nella richiesta delle categorie', async () => {
    await load();
    await showCategoryList();

    store.setClassification('unclassified');
    await settle();
    await settle();
    const params = await answer(`${RANGE}&classification=unclassified&${STEP}`, withTwoCategories());

    expect(params.has('classification')).toBe(false);
    expect(rows('app-analytics-categories .row').map((row) => row.name)).toEqual([
      'Alimentari',
      'Trasporti'
    ]);
  });

  it('filtrato un merchant, i merchant arrivano dalla richiesta senza il loro filtro', async () => {
    await load();

    await click('app-analytics-merchants .link');
    const params = await answer(`${RANGE}&merchantIds=m-1&${STEP}`, withTwoCategories());

    expect(params.has('merchantIds')).toBe(false);
    expect(rows('app-analytics-merchants .link')).toEqual([
      { name: 'ESSELUNGA', pressed: 'true' },
      { name: 'CARREFOUR', pressed: 'false' }
    ]);
    // KPI e categorie seguono la query completa.
    expect(sectionText('app-stat-card-grid')).toContain('300,00');
  });

  it('la tabella resta sulla query completa', async () => {
    await load();
    await showCategoryList();

    await click('app-analytics-categories .row');
    const requests = analyticsRequests();
    byQuery(requests, `${RANGE}&categoryIds=cat-1&${STEP}`).flush(narrowed());
    byQuery(requests, PERIOD).flush(withTwoCategories());
    await settle();
    await settle();

    const panel = http
      .match((request) => request.url === `${API_BASE_URL}/transactions`)
      .filter((request) => !request.cancelled);
    expect(panel.length).toBe(1);
    expect(panel[0]!.request.params.get('categoryIds')).toBe('cat-1');
    panel[0]!.flush({ items: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
    await settle();
  });

  it('se la richiesta delle categorie fallisce, la sezione usa la risposta principale', async () => {
    await load();
    await showCategoryList();

    await click('app-analytics-categories .row');
    await answer(`${RANGE}&categoryIds=cat-1&${STEP}`, 'error');

    expect(rows('app-analytics-categories .row')).toEqual([
      { name: 'Alimentari', pressed: 'true' }
    ]);
    // Nessun errore di pagina: la richiesta principale è andata a buon fine.
    expect(host().querySelector('.message--error')).toBeNull();
  });
});
