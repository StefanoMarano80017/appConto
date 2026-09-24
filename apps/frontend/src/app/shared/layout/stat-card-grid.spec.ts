import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StatCardGrid, StatCardItem } from './stat-card-grid';

describe('StatCardGrid', () => {
  let fixture: ComponentFixture<StatCardGrid>;

  const render = async (items: readonly StatCardItem[]) => {
    fixture = TestBed.createComponent(StatCardGrid);
    fixture.componentRef.setInput('items', items);
    await fixture.whenStable();
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StatCardGrid] }).compileComponents();
  });

  it('rende una card amount negativa come app-amount con il segno meno e il tono negativo', async () => {
    await render([{ kind: 'amount', label: 'Uscite', value: -530 }]);

    const amount = host().querySelector('app-amount') as HTMLElement;

    expect(amount).not.toBeNull();
    expect(amount.textContent?.trim().startsWith('−')).toBe(true);
    expect(amount.classList.contains('amount-negative')).toBe(true);
  });

  it('rende la stessa card con valore positivo con il segno più e il tono positivo', async () => {
    await render([{ kind: 'amount', label: 'Entrate', value: 530 }]);

    const amount = host().querySelector('app-amount') as HTMLElement;

    expect(amount.textContent?.trim().startsWith('+')).toBe(true);
    expect(amount.classList.contains('amount-positive')).toBe(true);
  });

  // Il terzo test protegge i conteggi: senza, il prossimo che tocca il
  // componente può far passare tutto da `Amount` e trasformare «42
  // transazioni» in «+42».
  it('rende una card text come stringa così com è, senza segno e senza Amount', async () => {
    await render([{ kind: 'text', label: 'Transazioni', value: '42' }]);

    expect(host().querySelector('app-amount')).toBeNull();

    const value = host().querySelector('.value') as HTMLElement;
    expect(value.textContent?.trim()).toBe('42');
  });
});
