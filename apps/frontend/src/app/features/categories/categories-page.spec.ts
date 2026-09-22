import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../core/api';
import { CategoriesPage } from './categories-page';
import { CategoryWithUsage } from './category.model';

describe('CategoriesPage', () => {
  let http: HttpTestingController;

  const category = (overrides: Partial<CategoryWithUsage> = {}): CategoryWithUsage => ({
    id: 'c-1',
    name: 'Alimentari',
    color: '#3f8f4f',
    merchantCount: 0,
    ...overrides
  });

  const load = (fixture: ReturnType<typeof TestBed.createComponent>, categories: CategoryWithUsage[] = []): void => {
    fixture.detectChanges();
    http.expectOne(`${API_BASE_URL}/categories`).flush(categories);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('carica e mostra le categorie', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    fixture.detectChanges();

    http.expectOne(`${API_BASE_URL}/categories`).flush([category(), category({ id: 'c-2', name: 'Casa' })]);
    fixture.detectChanges();

    const renameInputs = fixture.nativeElement.querySelectorAll('input.rename') as NodeListOf<HTMLInputElement>;
    expect(renameInputs.length).toBe(2);
    expect(renameInputs[0].value).toBe('Alimentari');
    expect(renameInputs[1].value).toBe('Casa');
  });

  it('mostra il numero di merchant assegnati', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    fixture.detectChanges();

    http.expectOne(`${API_BASE_URL}/categories`).flush([category({ merchantCount: 3 })]);
    fixture.detectChanges();

    expect((fixture.nativeElement.textContent as string)).toContain('3');
  });

  it('mostra un messaggio di errore se il caricamento fallisce', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    fixture.detectChanges();

    http.expectOne(`${API_BASE_URL}/categories`).flush('errore', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect((fixture.nativeElement.textContent as string)).toContain('Si è verificato un errore imprevisto.');
  });

  it('crea una nuova categoria dal form', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture);

    const nameInput = fixture.nativeElement.querySelector('input[name="newName"]') as HTMLInputElement;
    nameInput.value = 'Regali';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true })
    );
    fixture.detectChanges();

    const request = http.expectOne(`${API_BASE_URL}/categories`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.name).toBe('Regali');
    request.flush({ id: 'c-new', name: 'Regali', color: '#9aa3af' });
    fixture.detectChanges();

    const renameInputs = fixture.nativeElement.querySelectorAll('input.rename') as NodeListOf<HTMLInputElement>;
    const createdInput = Array.from(renameInputs).find((input) => input.value === 'Regali');
    expect(createdInput).toBeTruthy();
  });

  it('mostra un errore se il nome è già in uso', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture);

    const nameInput = fixture.nativeElement.querySelector('input[name="newName"]') as HTMLInputElement;
    nameInput.value = 'Doppione';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true })
    );

    http
      .expectOne(`${API_BASE_URL}/categories`)
      .flush({ error: 'Esiste già una categoria con il nome "Doppione".' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    expect((fixture.nativeElement.textContent as string)).toContain(
      'Esiste già una categoria con il nome "Doppione".'
    );
  });

  it('rinomina una categoria esistente', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category()]);

    const nameInput = fixture.nativeElement.querySelector('input.rename') as HTMLInputElement;
    nameInput.value = 'Spesa alimentare';
    nameInput.dispatchEvent(new Event('change'));

    const request = http.expectOne(`${API_BASE_URL}/categories/c-1`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ name: 'Spesa alimentare' });
    request.flush(category({ name: 'Spesa alimentare' }));
    fixture.detectChanges();

    const updatedInput = fixture.nativeElement.querySelector('input.rename') as HTMLInputElement;
    expect(updatedInput.value).toBe('Spesa alimentare');
  });

  it('non permette di rinominare «Da classificare»', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category({ id: 'c9bfcd74-e342-4a3f-8b0c-116f89236d51', name: 'Da classificare' })]);

    expect(fixture.nativeElement.querySelector('input.rename')).toBeNull();
  });

  it('chiede conferma prima di eliminare, mostrando quanti merchant verranno riassegnati', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category({ merchantCount: 3 })]);

    (fixture.nativeElement.querySelector('button.danger') as HTMLButtonElement).click();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('3');
    expect(fixture.nativeElement.querySelector('button.confirm-delete')).not.toBeNull();
    http.expectNone(`${API_BASE_URL}/categories/c-1`);
  });

  it('elimina la categoria alla conferma', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category()]);

    (fixture.nativeElement.querySelector('button.danger') as HTMLButtonElement).click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button.confirm-delete') as HTMLButtonElement).click();

    const request = http.expectOne(`${API_BASE_URL}/categories/c-1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();

    expect((fixture.nativeElement.textContent as string)).not.toContain('Alimentari');
  });

  it('annulla senza eliminare', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category()]);

    (fixture.nativeElement.querySelector('button.danger') as HTMLButtonElement).click();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('button.ghost') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button.confirm-delete')).toBeNull();
    http.expectNone(`${API_BASE_URL}/categories/c-1`);
  });

  it('non permette di eliminare «Da classificare»', () => {
    const fixture = TestBed.createComponent(CategoriesPage);
    load(fixture, [category({ id: 'c9bfcd74-e342-4a3f-8b0c-116f89236d51', name: 'Da classificare' })]);

    expect(fixture.nativeElement.querySelector('button.danger')).toBeNull();
  });
});
