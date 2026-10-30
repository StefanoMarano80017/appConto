import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardCategory } from './dashboard.model';
import { TopCategories } from './top-categories';

const category = (overrides: Partial<DashboardCategory> = {}): DashboardCategory => ({
  id: 'cat-1',
  name: 'Alimentari',
  color: '#3f8f4f',
  amount: 42.7,
  percentage: 31.6,
  difference: 30,
  ...overrides
});

describe('TopCategories', () => {
  let fixture: ComponentFixture<TopCategories>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (element: Element = host()): string =>
    (element.textContent ?? '').replace(/\s+/g, ' ');
  const rows = (): HTMLAnchorElement[] => [...host().querySelectorAll<HTMLAnchorElement>('a.row')];
  const row = (name: string): HTMLAnchorElement => rows().find((link) => text(link).includes(name))!;

  const render = async (categories: DashboardCategory[]): Promise<void> => {
    fixture = TestBed.createComponent(TopCategories);
    fixture.componentRef.setInput('categories', categories);
    fixture.componentRef.setInput('range', { from: '2026-09-01', to: '2026-09-30' });
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopCategories],
      providers: [provideRouter([])]
    }).compileComponents();
  });

  it('porta ai movimenti della categoria, del mese e dei tipi che fanno spesa', async () => {
    await render([category()]);

    const href = row('Alimentari').getAttribute('href') ?? '';
    expect(href).toContain('/transactions?');
    expect(href).toContain('categoryIds=cat-1');
    expect(href).toContain('types=EXPENSE,LOAN');
    expect(href).toContain('from=2026-09-01');
    expect(href).toContain('to=2026-09-30');
  });

  it('per la voce senza categoria filtra i movimenti da classificare', async () => {
    await render([category({ id: null, name: 'Senza categoria', color: null })]);

    const href = row('Senza categoria').getAttribute('href') ?? '';
    expect(href).toContain('classification=unclassified');
    expect(href).toContain('types=EXPENSE,LOAN');
    expect(href).not.toContain('categoryIds');
  });

  it('mostra importo negato e percentuale', async () => {
    await render([category()]);

    expect(text(row('Alimentari'))).toContain('−42,70 €');
    expect(text(row('Alimentari'))).toContain('31,6%');
  });

  it('una spesa in aumento ha la freccia in su e il tono negativo', async () => {
    await render([category({ difference: 30 })]);

    const change = row('Alimentari').querySelector('.change')!;
    expect(text(change)).toContain('↑ 30,00 €');
    expect(change.classList).toContain('change-negative');
  });

  it('una spesa in calo ha la freccia in giù e il tono positivo', async () => {
    await render([category({ difference: -5 })]);

    const change = row('Alimentari').querySelector('.change')!;
    expect(text(change)).toContain('↓ 5,00 €');
    expect(change.classList).toContain('change-positive');
  });

  it('senza variazione non mostra frecce', async () => {
    await render([category({ difference: 0 })]);

    expect(text(row('Alimentari'))).not.toContain('↑');
    expect(text(row('Alimentari'))).not.toContain('↓');
  });

  it('senza percentuale calcolabile non mostra «%»', async () => {
    await render([category({ percentage: null })]);

    expect(text(row('Alimentari'))).not.toContain('%');
  });

  it("porta all'analisi completa", async () => {
    await render([category()]);

    const link = [...host().querySelectorAll('a')].find((a) => text(a).includes('Analisi completa →'));
    expect(link?.getAttribute('href')).toBe('/analytics');
  });

  it('senza spese lo dice', async () => {
    await render([]);

    expect(rows()).toHaveLength(0);
    expect(text()).toContain('Nessuna spesa in questo mese');
  });
});
