import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsCategories } from './analytics-categories';
import { CategoryDistribution } from './analytics.model';

const category = (overrides: Partial<CategoryDistribution> = {}): CategoryDistribution => ({
  categoryId: 'cat-1',
  name: 'Alimentari',
  color: '#3f8f4f',
  amount: 530,
  transactionCount: 4,
  percentage: 100,
  ...overrides
});

describe('AnalyticsCategories', () => {
  let fixture: ComponentFixture<AnalyticsCategories>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const render = async (categories: CategoryDistribution[]): Promise<void> => {
    fixture = TestBed.createComponent(AnalyticsCategories);
    fixture.componentRef.setInput('categories', categories);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AnalyticsCategories] }).compileComponents();
  });

  // `amount` è la magnitudine di una spesa (v. analytics.service): il caso normale
  // mostra un'uscita, non un'entrata, anche se il valore in ingresso è positivo.
  it('una spesa normale mostra il segno meno e il tono di uscita', async () => {
    await render([category({ amount: 530 })]);

    const amount = host().querySelector('app-amount');

    expect(amount?.textContent).toContain('−530,00');
    expect(amount?.classList.contains('amount-negative')).toBe(true);
    expect(amount?.classList.contains('amount-positive')).toBe(false);
  });

  // Il caso che fissa la convenzione: un rimborso netto rende `amount` negativo.
  // Un tono forzato a 'negative' lo mostrerebbe comunque come un'uscita; negare
  // il valore e lasciare dedurre il segno lo mostra correttamente come un'entrata.
  it('un rimborso netto mostra il segno più e il tono di entrata', async () => {
    await render([category({ amount: -50 })]);

    const amount = host().querySelector('app-amount');

    expect(amount?.textContent).toContain('+50,00');
    expect(amount?.classList.contains('amount-positive')).toBe(true);
    expect(amount?.classList.contains('amount-negative')).toBe(false);
  });
});
