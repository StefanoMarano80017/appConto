import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { API_BASE_URL } from '../../core/api';
import { selectTrigger, selectedName } from '@shared/ui/forms/select/select.testing';
import { Category } from '../categories/category.model';
import { MerchantPage, MerchantSummary } from './merchant.model';
import { MerchantsPage } from './merchants-page';

const SPESA: Category = { id: 'c-1', name: 'Spesa', color: null } as Category;

const merchant = (overrides: Partial<MerchantSummary> = {}): MerchantSummary => ({
  id: 'm-1',
  name: 'ESSELUNGA SPA',
  displayName: null,
  label: 'ESSELUNGA SPA',
  normalizedName: 'esselunga spa',
  category: null,
  transactionCount: 12,
  totalSpent: 345.6,
  lastTransactionDate: '2026-09-30',
  ...overrides
});

const page = (overrides: Partial<MerchantPage> = {}): MerchantPage => ({
  items: [
    merchant(),
    merchant({
      id: 'm-2',
      name: 'AMAZON EU',
      label: 'Amazon',
      displayName: 'Amazon',
      normalizedName: 'amazon eu',
      category: SPESA,
      transactionCount: 4
    })
  ],
  pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
  counts: { all: 5, classified: 2, unclassified: 3 },
  ...overrides
});

describe('MerchantsPage', () => {
  let harness: RouterTestingHarness;
  let http: HttpTestingController;
  let router: Router;

  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  };

  const root = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const text = (): string => (root().textContent ?? '').replace(/\s+/g, ' ');

  /** Le richieste dell'elenco ancora in sospeso, qualunque sia la query string. */
  const pending = (): TestRequest[] =>
    http.match(
      (candidate) =>
        candidate.method === 'GET' && candidate.url === `${API_BASE_URL}/merchants`
    );

  /** Risponde all'elenco in corso e restituisce l'indirizzo richiesto. */
  const flush = async (data: MerchantPage = page()): Promise<string> => {
    const [request] = pending();
    expect(request).toBeDefined();
    const url = request!.request.urlWithParams;
    request!.flush(data);
    await settle();

    return url;
  };

  const flushCategories = async (): Promise<void> => {
    for (const request of http.match(`${API_BASE_URL}/categories`)) {
      request.flush([SPESA]);
    }
    await settle();
  };

  const open = async (url: string, data: MerchantPage = page()): Promise<void> => {
    await harness.navigateByUrl(url, MerchantsPage);
    await settle();
    await flushCategories();
    await flush(data);
  };

  /** Il bottone il cui testo contiene `label`, dentro `scope`. */
  const button = (label: string, scope = ''): HTMLButtonElement => {
    const found = Array.from(
      root().querySelectorAll<HTMLButtonElement>(`${scope} button`)
    ).find((candidate) => (candidate.textContent ?? '').replace(/\s+/g, ' ').includes(label));
    expect(found, `bottone "${label}"`).toBeDefined();

    return found!;
  };

  const click = async (element: HTMLElement): Promise<void> => {
    element.click();
    await settle();
    await settle();
  };

  /** Sceglie la categoria `name` nella riga del merchant mostrata per prima. */
  const chooseCategory = async (name: string): Promise<void> => {
    selectTrigger(root(), 'tbody tr:first-child .category').click();
    await settle();
    const option = Array.from(
      root().querySelectorAll<HTMLElement>('tbody tr:first-child .category [role="option"]')
    ).find((candidate) => candidate.textContent?.replace(/\s+/g, ' ').trim() === name);
    expect(option, `voce "${name}"`).toBeDefined();
    option!.click();
    await settle();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'merchants', component: MerchantsPage }])
      ],
      rethrowApplicationErrors: false
    });

    harness = await RouterTestingHarness.create();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  it('chiede la prima pagina con i criteri predefiniti', async () => {
    await harness.navigateByUrl('/merchants', MerchantsPage);
    await settle();
    await flushCategories();
    const url = await flush();

    expect(url).toBe(`${API_BASE_URL}/merchants`);
  });

  it('mostra righe, conteggi nei filtri e intervallo', async () => {
    await open('/merchants');

    expect(root().querySelectorAll('tbody tr').length).toBe(2);
    const segmenti = [...root().querySelectorAll<HTMLButtonElement>('app-choice-group button')];
    expect(segmenti.map((s) => s.querySelector('.label')?.textContent?.trim())).toEqual([
      'Tutti',
      'Classificati',
      'Da classificare',
    ]);
    expect(segmenti.map((s) => s.querySelector('.count')?.textContent?.trim())).toEqual(['5', '2', '3']);
    expect(segmenti.map((s) => s.getAttribute('aria-label'))).toEqual(['Tutti, 5', 'Classificati, 2', 'Da classificare, 3']);
    expect(text()).toContain('1–2 di 2 merchant');
  });

  it('clic su Nome ordina in crescente e torna a pagina 1', async () => {
    await open('/merchants?page=3', page({ pagination: { page: 3, pageSize: 25, total: 70, totalPages: 3 } }));

    await click(button('Nome', 'thead'));

    expect(router.url).toBe('/merchants?sortBy=name&sortDirection=asc');
    await flush();
  });

  it('clic sulla colonna attiva inverte la direzione', async () => {
    await open('/merchants');

    await click(button('Transazioni', 'thead'));

    expect(router.url).toBe('/merchants?sortDirection=asc');
    // httpResource azzera il valore quando cambia la richiesta: le righe di prima restano comunque.
    expect(root().querySelector('.skeleton')).toBeNull();
    expect(root().querySelectorAll('tbody tr').length).toBe(2);
    // Si attenua solo la tabella: intestazione, ricerca e filtro restano pieni.
    expect(root().querySelector('.table-area.stale')).not.toBeNull();
    expect(root().querySelector('app-panel.stale')).toBeNull();
    await flush();
  });

  it("scegliere un filtro aggiorna l'URL e torna a pagina 1", async () => {
    await open('/merchants?page=2', page({ pagination: { page: 2, pageSize: 25, total: 30, totalPages: 2 } }));

    await click(button('Da classificare', 'app-choice-group'));

    expect(router.url).toBe('/merchants?classification=unclassified');
    await flush();
  });

  it('una ricerca che non cambia il criterio non torna a pagina 1', async () => {
    await open('/merchants?search=coop&page=2', page({
      pagination: { page: 2, pageSize: 25, total: 30, totalPages: 2 }
    }));

    const input = root().querySelector<HTMLInputElement>('app-search-input input')!;
    input.value = 'coop ';
    input.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(router.url).toBe('/merchants?search=coop&page=2');
  });

  it("una ricerca nuova finisce nell'URL e torna a pagina 1", async () => {
    await open('/merchants?page=2', page({
      pagination: { page: 2, pageSize: 25, total: 30, totalPages: 2 }
    }));

    const input = root().querySelector<HTMLInputElement>('app-search-input input')!;
    input.value = 'coop';
    input.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(router.url).toBe('/merchants?search=coop');
    await flush();
  });

  it('dopo aver assegnato una categoria ricarica la pagina corrente', async () => {
    await open('/merchants?classification=unclassified&page=2', page({
      pagination: { page: 2, pageSize: 25, total: 30, totalPages: 2 }
    }));

    await chooseCategory('Spesa');

    const patch = http.expectOne(`${API_BASE_URL}/merchants/m-1/category`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ categoryId: 'c-1' });
    patch.flush({ ...merchant(), category: SPESA });
    await settle();

    // Durante la ricarica le righe restano visibili: niente skeleton, niente lampeggio, niente attenuazione.
    expect(root().querySelector('.skeleton')).toBeNull();
    expect(root().querySelectorAll('tbody tr').length).toBe(2);
    expect(root().querySelector('.stale')).toBeNull();

    const url = await flush(page({ items: [merchant({ id: 'm-3', label: 'Coop', name: 'COOP' })] }));
    expect(url).toBe(`${API_BASE_URL}/merchants?classification=unclassified&page=2`);
    expect(root().querySelector('input[aria-label="Nome di COOP"]')).not.toBeNull();
  });

  it("pagina oltre l'ultima con risultati: resta sulla pagina e lo dice", async () => {
    await open('/merchants?page=4', page({
      items: [],
      pagination: { page: 4, totalPages: 3, total: 60, pageSize: 25 },
      counts: { all: 80, classified: 20, unclassified: 60 }
    }));

    expect(text()).toContain('Hai sistemato tutti i merchant di questa pagina.');
    expect(text()).toContain('Ne restano 60 nelle pagine precedenti.');
    expect(root().querySelector('app-pagination .range')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '60 merchant'
    );
    expect(router.url).toBe('/merchants?page=4');

    await click(button("Vai all'ultima pagina"));

    expect(router.url).toBe('/merchants?page=3');
    await flush();
  });

  it('tutto classificato', async () => {
    await open('/merchants?classification=unclassified', page({
      items: [],
      pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
      counts: { all: 5, classified: 5, unclassified: 0 }
    }));

    expect(text()).toContain('Tutti i merchant sono stati classificati.');
  });

  it('nessun merchant', async () => {
    await open('/merchants', page({
      items: [],
      pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
      counts: { all: 0, classified: 0, unclassified: 0 }
    }));

    expect(text()).toContain('Nessun merchant. Importa un estratto conto per iniziare.');
  });

  it('nessun risultato per la ricerca', async () => {
    await open('/merchants?search=zzz&classification=classified', page({
      items: [],
      pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 }
    }));

    expect(text()).toContain('Nessun merchant corrisponde alla ricerca.');

    await click(button('Azzera', '.empty'));

    expect(router.url).toBe('/merchants');
    await flush();
  });

  it('errore nel salvataggio: lo mostra e ricarica la pagina', async () => {
    await open('/merchants');

    await chooseCategory('Spesa');

    http
      .expectOne(`${API_BASE_URL}/merchants/m-1/category`)
      .flush({ error: 'Categoria inesistente.' }, { status: 500, statusText: 'Error' });
    await settle();

    expect(text()).toContain('Categoria inesistente.');
    expect(root().querySelector('.stale')).toBeNull();
    await flush();

    // La riga torna al valore salvato e l'errore resta visibile.
    expect(selectedName(root(), 'tbody tr:first-child .category')).toBe('— Nessuna categoria');
    expect(text()).toContain('Categoria inesistente.');
  });

  it('errore nella rinomina: il campo torna al nome salvato', async () => {
    await open('/merchants');

    const input = root().querySelector<HTMLInputElement>('input[aria-label="Nome di ESSELUNGA SPA"]')!;
    input.value = 'Esselunga';
    input.dispatchEvent(new Event('change'));
    await settle();

    const patch = http.expectOne(`${API_BASE_URL}/merchants/m-1`);
    expect(patch.request.body).toEqual({ displayName: 'Esselunga' });
    patch.flush({ error: 'Nome non valido.' }, { status: 500, statusText: 'Error' });
    await settle();
    await flush();

    expect(root().querySelector<HTMLInputElement>('input[aria-label="Nome di ESSELUNGA SPA"]')!.value).toBe('');
    expect(text()).toContain('Nome non valido.');
  });

  describe('uscita animata della riga', () => {
    /** Per ogni riga a schermo, la classe con cui uscirebbe se sparisse adesso. */
    const leaving = (): [string, string][] =>
      (harness.routeDebugElement!.componentInstance as { rows(): { merchant: MerchantSummary; leave: string }[] })
        .rows()
        .map((row) => [row.merchant.id, row.leave]);

    const saveCategory = async (): Promise<void> => {
      await chooseCategory('Spesa');
      http.expectOne(`${API_BASE_URL}/merchants/m-1/category`).flush({ ...merchant(), category: SPESA });
      await settle();
    };

    it('dopo un salvataggio riuscito solo la riga salvata è pronta a uscire', async () => {
      await open('/merchants?classification=unclassified');

      expect(leaving()).toEqual([['m-1', ''], ['m-2', '']]);

      await saveCategory();

      expect(leaving()).toEqual([['m-1', 'row-leaving'], ['m-2', '']]);
      // Fino alla ricarica la riga resta attenuata: la dissolvenza parte da lì, senza lampeggi.
      expect(root().querySelector('tbody tr:first-child')!.classList).toContain('saving');

      // Arrivata la ricarica, le righe rimaste (e quella risalita) non porterebbero animazioni.
      await flush(page({ items: [merchant({ id: 'm-2' }), merchant({ id: 'm-3' })] }));

      expect(leaving()).toEqual([['m-2', ''], ['m-3', '']]);
    });

    it('la riga salvata che resta in elenco torna normale dopo la ricarica', async () => {
      await open('/merchants');
      await saveCategory();

      expect(root().querySelector('tbody tr:first-child')!.classList).toContain('saving');

      await flush(page({ items: [merchant({ category: SPESA }), merchant({ id: 'm-2' })] }));

      expect(leaving()).toEqual([['m-1', ''], ['m-2', '']]);
      expect(root().querySelector('tbody tr.saving')).toBeNull();
    });

    it('cambiando ordinamento durante la ricarica nessuna riga esce animata', async () => {
      await open('/merchants?classification=unclassified');
      await saveCategory();

      await click(button('Nome', 'thead'));

      expect(leaving()).toEqual([['m-1', ''], ['m-2', '']]);
      // La ricarica è stata annullata dal cambio di criteri: risponde solo l'elenco ordinato.
      for (const request of pending().filter((candidate) => !candidate.cancelled)) {
        request.flush(page());
      }
      await settle();
    });

    it('dopo un salvataggio fallito nessuna riga esce animata', async () => {
      await open('/merchants?classification=unclassified');

      await chooseCategory('Spesa');
      http
        .expectOne(`${API_BASE_URL}/merchants/m-1/category`)
        .flush({ error: 'Categoria inesistente.' }, { status: 500, statusText: 'Error' });
      await settle();

      expect(leaving()).toEqual([['m-1', ''], ['m-2', '']]);
      await flush();
    });
  });

  it('errore nel caricamento: Riprova rilancia la richiesta', async () => {
    await harness.navigateByUrl('/merchants', MerchantsPage);
    await settle();
    await flushCategories();

    pending()[0]!.flush({ error: 'Database non raggiungibile.' }, { status: 500, statusText: 'Error' });
    await settle();

    expect(text()).toContain('Database non raggiungibile.');

    await click(button('Riprova'));
    await flush();

    expect(root().querySelector('input[aria-label="Nome di ESSELUNGA SPA"]')).not.toBeNull();
  });
});
