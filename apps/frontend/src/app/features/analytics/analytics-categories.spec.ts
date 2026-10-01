import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { vi } from 'vitest';
import { formatPercent } from '../../core/format';
import { ThemeStore } from '../../core/theme';
import { CHART_CONSTRUCTOR } from '../../shared/ui/chart/doughnut-chart';
import { AnalyticsCategories } from './analytics-categories';
import { CategoryDistribution } from './analytics.model';

// Il disegno vero è coperto da doughnut-chart.spec.ts: qui basta un Chart.js finto
// che si lasci creare ed esponga `data` e `options`, per provare il collegamento.
const chartMocks = (() => {
  const instances: Array<{ data: any; options: any }> = [];

  class MockChart {
    data: any;
    options: any;
    update(): void {}
    destroy(): void {}
    setActiveElements(): void {}

    constructor(_canvas: unknown, config: any) {
      this.data = config.data;
      this.options = config.options;
      instances.push(this);
    }
  }

  return { instances, MockChart };
})();

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
  let appTheme: WritableSignal<'light' | 'dark'>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const render = async (categories: CategoryDistribution[]): Promise<void> => {
    fixture = TestBed.createComponent(AnalyticsCategories);
    fixture.componentRef.setInput('categories', categories);
    await fixture.whenStable();
  };

  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(host().querySelectorAll<HTMLButtonElement>('app-choice-group button')).find(
      (candidate) => candidate.getAttribute('aria-label') === label
    );
  const choose = async (label: string): Promise<void> => {
    button(label)?.click();
    await fixture.whenStable();
  };
  const center = (): string => host().querySelector('.center')?.textContent ?? '';
  const chart = () => chartMocks.instances.at(-1)!;
  const overSlice = async (index: number): Promise<void> => {
    chart().options.onHover({}, [{ datasetIndex: 0, index }]);
    await fixture.whenStable();
  };
  const clickSlice = async (index: number): Promise<void> => {
    chart().options.onClick({}, [{ datasetIndex: 0, index }]);
    await fixture.whenStable();
  };
  // Sette voci con topN 5: le ultime due (20 e 10) finiscono in «Altri». Le
  // percentuali sono diverse dagli importi, così l'una non si scambia per l'altro.
  const many = (): CategoryDistribution[] =>
    [70, 60, 50, 40, 30, 20, 10].map((amount, index) =>
      category({
        categoryId: `cat-${index}`,
        name: `Categoria ${index}`,
        amount,
        percentage: amount / 4
      })
    );

  beforeEach(async () => {
    chartMocks.instances.length = 0;
    appTheme = signal<'light' | 'dark'>('light');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D
    );
    await TestBed.configureTestingModule({
      imports: [AnalyticsCategories],
      providers: [
        { provide: ThemeStore, useValue: { theme: appTheme } },
        { provide: CHART_CONSTRUCTOR, useValue: chartMocks.MockChart }
      ]
    }).compileComponents();
  });

  // `amount` è la magnitudine di una spesa (v. analytics.service): il caso normale
  // mostra un'uscita, non un'entrata, anche se il valore in ingresso è positivo.
  it('una spesa normale mostra il segno meno e il tono di uscita', async () => {
    await render([category({ amount: 530 })]);
    await choose('Lista');

    const amount = host().querySelector('ul app-amount');

    expect(amount?.textContent).toContain('−530,00');
    expect(amount?.classList.contains('amount-negative')).toBe(true);
    expect(amount?.classList.contains('amount-positive')).toBe(false);
  });

  // Il caso che fissa la convenzione: un rimborso netto rende `amount` negativo.
  // Un tono forzato a 'negative' lo mostrerebbe comunque come un'uscita; negare
  // il valore e lasciare dedurre il segno lo mostra correttamente come un'entrata.
  it('un rimborso netto mostra il segno più e il tono di entrata', async () => {
    await render([category({ amount: -50 })]);
    await choose('Lista');

    const amount = host().querySelector('ul app-amount');

    expect(amount?.textContent).toContain('+50,00');
    expect(amount?.classList.contains('amount-positive')).toBe(true);
    expect(amount?.classList.contains('amount-negative')).toBe(false);
  });

  it('di default mostra il grafico; Lista mostra le righe e Grafico torna alla ciambella', async () => {
    await render([category()]);

    expect(button('Grafico')?.getAttribute('aria-pressed')).toBe('true');
    expect(host().querySelector('app-doughnut-chart')).not.toBeNull();
    expect(host().querySelector('ul')).toBeNull();

    await choose('Lista');
    expect(button('Lista')?.getAttribute('aria-pressed')).toBe('true');
    expect(host().querySelectorAll('ul .row')).toHaveLength(1);
    expect(host().querySelector('app-doughnut-chart')).toBeNull();

    await choose('Grafico');
    expect(host().querySelector('app-doughnut-chart')).not.toBeNull();
    expect(host().querySelector('ul')).toBeNull();
  });

  it('il click su una fetta emette la categoria; su «Altri» passa alla Lista', async () => {
    await render(many());
    const emitted: Array<string | null> = [];
    fixture.componentInstance.categorySelected.subscribe((id) => emitted.push(id));

    await clickSlice(0);
    expect(emitted).toEqual(['cat-0']);

    await clickSlice(5);
    expect(emitted).toEqual(['cat-0']);
    expect(host().querySelector('app-doughnut-chart')).toBeNull();
    expect(host().querySelectorAll('ul .row')).toHaveLength(7);
  });

  it('attivare «Altri» da tastiera porta il focus sulla prima categoria raggruppata', async () => {
    await render(many());
    const canvas = host().querySelector<HTMLCanvasElement>('app-doughnut-chart canvas')!;
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', cancelable: true }));
    await fixture.whenStable();

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    await fixture.whenStable();

    // Il canvas non c'è più: senza spostarlo, il focus cadrebbe su <body>.
    const row = host().querySelectorAll<HTMLButtonElement>('ul .row')[5];
    expect(row.getAttribute('aria-label')).toBe('Filtra per Categoria 5');
    expect(document.activeElement).toBe(row);
  });

  it('una categoria senza colore prende il neutro del design system', async () => {
    await render([
      category({ categoryId: null, color: null, amount: 30 }),
      category({ categoryId: 'cat-2', color: '#3f8f4f', amount: 20 })
    ]);
    // Il token sta sull'elemento e non su :root (la fixture non è nel documento);
    // il cambio di tema fa rileggere i token, come in doughnut-chart.spec.ts.
    host().querySelector<HTMLElement>('app-doughnut-chart')!.style.setProperty(
      '--color-chart-neutral',
      'rgb(1, 2, 3)'
    );
    appTheme.set('dark');
    await fixture.whenStable();

    expect(chart().data.datasets[0].backgroundColor).toEqual(['rgb(1, 2, 3)', '#3f8f4f']);
  });

  it('senza fetta attiva il centro mostra il totale delle spese', async () => {
    await render([category({ amount: 30 }), category({ categoryId: 'cat-2', amount: 20 })]);

    expect(center()).toContain('Totale spese');
    expect(center()).toContain('−50,00');
  });

  it('con la fetta attiva il centro mostra nome, importo e percentuale', async () => {
    await render([category({ name: 'Casa', amount: 30, percentage: 60 })]);
    await overSlice(0);

    expect(center()).toContain('Casa');
    expect(center()).toContain('−30,00');
    expect(center()).toContain('60');
  });

  it('con «Altri» attiva il centro somma importi e percentuali delle voci raggruppate', async () => {
    await render(many());
    await overSlice(5);

    expect(center()).toContain('Altri');
    expect(center()).toContain('−30,00');
    expect(center()).toContain(formatPercent(5 + 2.5));
  });

  // jsdom non fa layout: l'altezza (25rem) si vede in pagina. Qui si prova ciò che la rende
  // uguale fra le viste, cioè che ogni stato viva nello stesso corpo, e che la Lista scorra
  // dentro un contenitore proprio invece di allungare la scheda.
  it('ogni stato della scheda sta nello stesso corpo ad altezza fissa', async () => {
    await render([category()]);
    expect(host().querySelectorAll('.body')).toHaveLength(1);
    expect(host().querySelector('.body app-doughnut-chart')).not.toBeNull();

    await choose('Lista');
    expect(host().querySelectorAll('.body')).toHaveLength(1);
    expect(host().querySelector('.body .list ul .row')).not.toBeNull();

    await render([]);
    expect(host().querySelector('.body .message')).not.toBeNull();

    await render([category({ amount: -50 })]);
    expect(host().querySelector('.body .message')).not.toBeNull();
  });

  it("senza categorie non c'è il toggle e resta il messaggio", async () => {
    await render([]);

    expect(host().querySelector('app-choice-group')).toBeNull();
    expect(host().textContent).toContain('Nessuna spesa nel periodo selezionato.');
  });

  it('con soli rimborsi netti il grafico cede il posto al messaggio, ma la Lista resta', async () => {
    await render([category({ amount: -50 }), category({ categoryId: 'cat-2', amount: 0 })]);

    expect(host().textContent).toContain('Nessuna spesa netta da rappresentare.');
    expect(host().querySelector('app-doughnut-chart')).toBeNull();
    expect(button('Grafico')).toBeDefined();

    await choose('Lista');
    expect(host().querySelectorAll('ul .row')).toHaveLength(2);
  });
});
