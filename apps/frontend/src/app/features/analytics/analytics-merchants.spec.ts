import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsMerchants } from './analytics-merchants';
import { MerchantDistribution } from './analytics.model';

const merchant = (overrides: Partial<MerchantDistribution> = {}): MerchantDistribution => ({
  merchantId: 'm-1',
  name: 'ESSELUNGA',
  category: 'Alimentari',
  amount: 530,
  transactionCount: 4,
  percentage: 100,
  ...overrides
});

describe('AnalyticsMerchants', () => {
  let fixture: ComponentFixture<AnalyticsMerchants>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const render = async (merchants: MerchantDistribution[]): Promise<void> => {
    fixture = TestBed.createComponent(AnalyticsMerchants);
    fixture.componentRef.setInput('merchants', merchants);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AnalyticsMerchants] }).compileComponents();
  });

  // Come in analytics-categories: `amount` è la magnitudine di una spesa.
  it('una spesa normale mostra il segno meno e il tono di uscita', async () => {
    await render([merchant({ amount: 530 })]);

    const amount = host().querySelector('app-amount');

    expect(amount?.textContent).toContain('−530,00');
    expect(amount?.classList.contains('amount-negative')).toBe(true);
    expect(amount?.classList.contains('amount-positive')).toBe(false);
  });

  it('un rimborso netto mostra il segno più e il tono di entrata', async () => {
    await render([merchant({ amount: -50 })]);

    const amount = host().querySelector('app-amount');

    expect(amount?.textContent).toContain('+50,00');
    expect(amount?.classList.contains('amount-positive')).toBe(true);
    expect(amount?.classList.contains('amount-negative')).toBe(false);
  });
});
