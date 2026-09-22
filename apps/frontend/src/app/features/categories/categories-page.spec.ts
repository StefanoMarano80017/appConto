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

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Alimentari');
    expect(text).toContain('Casa');
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
});
