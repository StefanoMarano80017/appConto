import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SearchInput } from '@shared/ui/forms/search-input/search-input';
import { Select } from '@shared/ui/forms/select/select';
import { ColorPicker } from '@shared/ui/forms/color-picker/color-picker';
import { API_BASE_URL } from '../../core/api';
import { CategoriesPage } from './categories-page';
import { CategoryWithUsage } from './category.model';

const FALLBACK_ID = 'c9bfcd74-e342-4a3f-8b0c-116f89236d51';

describe('CategoriesPage', () => {
  let http: HttpTestingController;

  const category = (overrides: Partial<CategoryWithUsage> = {}): CategoryWithUsage => ({
    id: 'c-1',
    name: 'Alimentari',
    color: '#3f8f4f',
    merchantCount: 0,
    ...overrides,
  });

  const load = (
    fixture: ComponentFixture<CategoriesPage>,
    categories: CategoryWithUsage[] = [],
  ): void => {
    fixture.detectChanges();
    http.expectOne(`${API_BASE_URL}/categories`).flush(categories);
    fixture.detectChanges();
  };

  const root = (fixture: ComponentFixture<CategoriesPage>): HTMLElement => fixture.nativeElement;

  const tiles = (fixture: ComponentFixture<CategoriesPage>): HTMLElement[] =>
    Array.from(root(fixture).querySelectorAll<HTMLElement>('app-category-tile'));

  const names = (fixture: ComponentFixture<CategoriesPage>): string[] =>
    tiles(fixture).map((tile) => tile.querySelector('.name-text')?.textContent?.trim() ?? '');

  const click = (element: Element | null | undefined): void => {
    (element as HTMLElement).click();
  };

  /** Entra in modifica sulla tessera, scrive il testo e preme Invio. */
  const typeAndEnter = (
    fixture: ComponentFixture<CategoriesPage>,
    tile: HTMLElement,
    text: string,
    startEditing = true,
  ): void => {
    if (startEditing) {
      click(tile.querySelector('button.name'));
      fixture.detectChanges();
    }
    const input = tile.querySelector('input.name-input') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
  };

  const buttonByText = (fixture: ComponentFixture<CategoriesPage>, text: string): HTMLElement =>
    Array.from(root(fixture).querySelectorAll<HTMLElement>('button')).find((button) =>
      button.textContent?.includes(text),
    ) as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('mostra una tessera per categoria, in ordine alfabetico', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category({ id: 'c-2', name: 'Casa' }), category()]);

    expect(names(fixture)).toEqual(['Alimentari', 'Casa']);
  });

  it('mostra lo skeleton con dodici rettangoli durante il primo caricamento', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    fixture.detectChanges();

    expect(root(fixture).querySelectorAll('.skeleton .line').length).toBe(12);
    http.expectOne(`${API_BASE_URL}/categories`).flush([]);
  });

  it('ordina per più merchant dal selettore Ordina', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [
      category({ id: 'c-1', name: 'Alimentari', merchantCount: 1 }),
      category({ id: 'c-2', name: 'Casa', merchantCount: 5 }),
    ]);

    fixture.debugElement
      .query(By.directive(Select))
      .triggerEventHandler('valueChange', 'merchants-desc');
    fixture.detectChanges();

    expect(names(fixture)).toEqual(['Casa', 'Alimentari']);
  });

  it('la ricerca filtra le tessere; senza risultati mostra lo stato vuoto e Azzera ricerca ripristina', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category({ name: 'Bar e caffè' }), category({ id: 'c-2', name: 'Casa' })]);
    const search = fixture.debugElement.query(By.directive(SearchInput));

    search.triggerEventHandler('valueChange', 'caffe');
    fixture.detectChanges();
    expect(names(fixture)).toEqual(['Bar e caffè']);

    search.triggerEventHandler('valueChange', 'zzz');
    fixture.detectChanges();
    expect(tiles(fixture).length).toBe(0);
    expect(root(fixture).textContent).toContain('Nessuna categoria corrisponde alla ricerca.');

    click(buttonByText(fixture, 'Azzera ricerca'));
    fixture.detectChanges();
    expect(names(fixture)).toEqual(['Bar e caffè', 'Casa']);
  });

  it('rinomina: PATCH con il nuovo nome e la tessera si riposiziona', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category(), category({ id: 'c-2', name: 'Casa' })]);

    typeAndEnter(fixture, tiles(fixture)[0], 'Zucchero');

    const request = http.expectOne(`${API_BASE_URL}/categories/c-1`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ name: 'Zucchero' });
    request.flush(category({ name: 'Zucchero' }));
    fixture.detectChanges();

    expect(names(fixture)).toEqual(['Casa', 'Zucchero']);
  });

  it('rinomina fallita: mostra l\'errore, ricarica e la tessera mostra il nome salvato', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category()]);

    typeAndEnter(fixture, tiles(fixture)[0], 'Casa');
    http
      .expectOne(`${API_BASE_URL}/categories/c-1`)
      .flush({ message: 'Nome già in uso' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(root(fixture).querySelector('[role="alert"]')).not.toBeNull();
    http.expectOne(`${API_BASE_URL}/categories`).flush([category()]);
    fixture.detectChanges();

    expect(names(fixture)).toEqual(['Alimentari']);
  });

  it('due salvataggi concorrenti: la seconda tessera resta occupata finché non risponde', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category(), category({ id: 'c-2', name: 'Casa' })]);

    typeAndEnter(fixture, tiles(fixture)[0], 'Alimenti');
    typeAndEnter(fixture, tiles(fixture)[1], 'Abitazione');

    const first = http.expectOne(`${API_BASE_URL}/categories/c-1`);
    const second = http.expectOne(`${API_BASE_URL}/categories/c-2`);
    first.flush(category({ name: 'Alimenti' }));
    fixture.detectChanges();

    const secondTile = tiles(fixture).find((tile) => tile.classList.contains('busy'));
    expect(secondTile).toBeDefined();
    expect((secondTile!.querySelector('button.name') as HTMLButtonElement).disabled).toBe(true);

    second.flush(category({ id: 'c-2', name: 'Abitazione' }));
    fixture.detectChanges();
    expect(tiles(fixture).some((tile) => tile.classList.contains('busy'))).toBe(false);
  });

  it('cambio colore: PATCH con il colore', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category()]);

    fixture.debugElement
      .query(By.directive(ColorPicker))
      .triggerEventHandler('valueCommitted', '#112233');

    const request = http.expectOne(`${API_BASE_URL}/categories/c-1`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ color: '#112233' });
    request.flush(category({ color: '#112233' }));
  });

  it('Nuova categoria apre la bozza in testa; Invio crea e la tessera entra in ordine', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category(), category({ id: 'c-2', name: 'Casa' })]);

    click(buttonByText(fixture, '+ Nuova categoria'));
    fixture.detectChanges();

    expect(tiles(fixture).length).toBe(3);
    expect(tiles(fixture)[0].querySelector('input.name-input')).not.toBeNull();
    expect((buttonByText(fixture, '+ Nuova categoria') as HTMLButtonElement).disabled).toBe(true);

    typeAndEnter(fixture, tiles(fixture)[0], 'Regali', false);

    const request = http.expectOne(`${API_BASE_URL}/categories`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Regali', color: '#9aa3af' });
    request.flush({ id: 'c-3', name: 'Regali', color: '#9aa3af' });
    fixture.detectChanges();

    expect(names(fixture)).toEqual(['Alimentari', 'Casa', 'Regali']);
    expect(root(fixture).querySelector('input.name-input')).toBeNull();
  });

  it('creazione fallita: errore visibile e bozza ancora aperta col testo', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category()]);

    click(buttonByText(fixture, '+ Nuova categoria'));
    fixture.detectChanges();
    typeAndEnter(fixture, tiles(fixture)[0], 'Alimentari', false);

    http
      .expectOne(`${API_BASE_URL}/categories`)
      .flush({ message: 'Nome già in uso' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect(root(fixture).querySelector('[role="alert"]')).not.toBeNull();
    const input = root(fixture).querySelector('input.name-input') as HTMLInputElement;
    expect(input.value).toBe('Alimentari');
  });

  it('eliminazione: conferma nella tessera, DELETE, la tessera sparisce', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category({ merchantCount: 2 })]);

    click(root(fixture).querySelector('button.delete'));
    fixture.detectChanges();
    expect(root(fixture).textContent).toContain('2 merchant verranno spostati');

    click(buttonByText(fixture, 'Sì, elimina'));
    const request = http.expectOne(`${API_BASE_URL}/categories/c-1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
    fixture.detectChanges();

    expect(tiles(fixture).length).toBe(0);
  });

  it('Da classificare non ha cestino né rinomina', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category({ id: FALLBACK_ID, name: 'Da classificare' })]);

    const tile = tiles(fixture)[0];
    expect(tile.querySelector('button.delete')).toBeNull();
    expect(tile.querySelector('button.name')).toBeNull();
    expect(tile.querySelector('button.edit')).toBeNull();
    expect(tile.querySelector('app-color-picker')).not.toBeNull();
  });

  it('nessuna categoria: Crea la prima categoria apre la bozza', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, []);

    expect(root(fixture).textContent).toContain('Nessuna categoria.');
    click(buttonByText(fixture, 'Crea la prima categoria'));
    fixture.detectChanges();

    expect(root(fixture).querySelector('input.name-input')).not.toBeNull();
  });

  it('errore di caricamento: Riprova rilancia la GET', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    fixture.detectChanges();

    http
      .expectOne(`${API_BASE_URL}/categories`)
      .flush('errore', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(root(fixture).textContent).toContain('Si è verificato un errore imprevisto.');

    click(buttonByText(fixture, 'Riprova'));
    http.expectOne(`${API_BASE_URL}/categories`).flush([category()]);
    fixture.detectChanges();

    expect(names(fixture)).toEqual(['Alimentari']);
  });
});
