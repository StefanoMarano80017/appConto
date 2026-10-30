import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RecentTransaction } from './dashboard.model';
import { RecentTransactions } from './recent-transactions';

const transaction = (day: number, overrides: Partial<RecentTransaction> = {}): RecentTransaction => ({
  id: `t-${day}`,
  bookingDate: `2026-09-2${day}`,
  label: `MERCHANT ${day}`,
  type: 'EXPENSE',
  category: { id: 'cat-1', name: 'Tempo libero', color: '#3f8f4f' },
  amount: -7,
  ...overrides
});

describe('RecentTransactions', () => {
  let fixture: ComponentFixture<RecentTransactions>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (element: Element = host()): string =>
    (element.textContent ?? '').replace(/\s+/g, ' ');
  const rows = (): HTMLElement[] => [...host().querySelectorAll<HTMLElement>('li')];

  const render = async (transactions: RecentTransaction[]): Promise<void> => {
    fixture = TestBed.createComponent(RecentTransactions);
    fixture.componentRef.setInput('transactions', transactions);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecentTransactions],
      providers: [provideRouter([])]
    }).compileComponents();
  });

  it("mostra le righe nell'ordine ricevuto", async () => {
    // Ordine volutamente non cronologico: l'ordinamento è del backend, qui non si tocca.
    await render([3, 5, 1, 4, 2].map((day) => transaction(day)));

    expect(rows().map((row) => row.querySelector('.label')?.textContent?.trim())).toEqual([
      'MERCHANT 3',
      'MERCHANT 5',
      'MERCHANT 1',
      'MERCHANT 4',
      'MERCHANT 2'
    ]);
    expect(text(rows()[0])).toContain('23/09/2026');
    expect(text(rows()[0])).toContain('Tempo libero');
    expect(text(rows()[0])).toContain('−7,00 €');
  });

  it('una riga senza categoria lo dice', async () => {
    await render([transaction(1, { category: null })]);

    expect(text(rows()[0])).toContain('Senza categoria');
  });

  it('porta a tutti i movimenti', async () => {
    await render([transaction(1)]);

    const link = [...host().querySelectorAll('a')].find((a) => text(a).includes('Tutti i movimenti →'));
    expect(link?.getAttribute('href')).toBe('/transactions');
  });

  it("con l'archivio vuoto invita a importare", async () => {
    await render([]);

    expect(rows()).toHaveLength(0);
    expect(text()).toContain('Nessun movimento importato');

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const action = [...host().querySelectorAll('button')].find((b) => text(b).includes('Importa estratto conto'))!;
    action.click();

    expect(navigate).toHaveBeenCalledWith('/import');
  });
});
