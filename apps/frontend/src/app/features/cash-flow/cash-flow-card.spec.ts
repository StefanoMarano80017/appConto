import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CashFlowCard } from './cash-flow-card';
import { CashFlow } from './cash-flow.model';

const cashFlow = (overrides: Partial<CashFlow> = {}): CashFlow => ({
  month: '2026-07',
  openingBalance: 2000,
  balanceDate: '2026-06-30',
  income: 1725,
  expenses: 1921.57,
  netMovement: -710.06,
  closingBalance: 1289.94,
  netWorthChange: -210.06,
  transactionCount: 45,
  byType: [
    { type: 'EXPENSE', amount: -1921.57, transactionCount: 43 },
    { type: 'WITHDRAWAL', amount: -500, transactionCount: 1 },
    { type: 'INCOME', amount: 1725, transactionCount: 1 }
  ],
  ...overrides
});

describe('CashFlowCard', () => {
  let fixture: ComponentFixture<CashFlowCard>;

  /** Il separatore delle migliaia dipende dall'ICU disponibile: lo si ignora. */
  const text = (): string =>
    ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\./g, '');

  const render = async (data: CashFlow): Promise<void> => {
    fixture.componentRef.setInput('cashFlow', data);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CashFlowCard],
      providers: [provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(CashFlowCard);
  });

  it('mostra saldo iniziale, movimenti e disponibile', async () => {
    await render(cashFlow());

    expect(text()).toContain('Saldo iniziale');
    expect(text()).toContain('2000,00');
    expect(text()).toContain('-710,06');
    expect(text()).toContain('Disponibile');
    expect(text()).toContain('1289,94');
  });

  it('si aggiorna quando cambiano i dati del mese', async () => {
    await render(cashFlow());

    await render(
      cashFlow({ month: '2026-08', openingBalance: 1289.94, netMovement: -13.49, closingBalance: 1276.45 })
    );

    expect(text()).toContain('1276,45');
    expect(text()).toContain('agosto');
  });

  it('mostra la variazione patrimonio solo quando differisce dai movimenti', async () => {
    await render(cashFlow());

    expect(text()).toContain('Variazione patrimonio');
    expect(text()).toContain('-210,06');
  });

  it('nasconde la variazione patrimonio quando coincide con i movimenti', async () => {
    await render(cashFlow({ netWorthChange: -710.06 }));

    expect(text()).not.toContain('Variazione patrimonio');
  });

  it('mostra i prelievi separatamente nel dettaglio per tipo', async () => {
    await render(cashFlow());

    expect(text()).toContain('Prelievi');
    expect(text()).toContain('-500,00');
    expect(text()).toContain('Spese');
    expect(text()).toContain('Entrate');
  });

  it('invita a impostare il saldo quando non è configurato', async () => {
    await render(cashFlow({ balanceDate: null, openingBalance: 0 }));

    expect(text()).toContain('Imposta il saldo iniziale');
  });

  it('un mese senza movimenti mostra comunque il saldo riportato', async () => {
    await render(
      cashFlow({
        income: 0,
        expenses: 0,
        netMovement: 0,
        closingBalance: 2000,
        netWorthChange: 0,
        transactionCount: 0,
        byType: []
      })
    );

    expect(text()).toContain('Disponibile');
    expect(text()).not.toContain('Distribuzione movimenti');
  });
});
