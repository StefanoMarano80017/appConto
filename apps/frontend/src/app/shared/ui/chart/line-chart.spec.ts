import { Component, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ThemeStore } from '../../../core/theme';
import { CHART_CONSTRUCTOR } from './chart';
import { LineChart } from './line-chart';
import type { LinePointMarker, LineSeries } from './line-chart.model';
import { LINE_CHART_PLUGINS } from './line-guides-plugin';

const chartMocks = (() => {
  const instances: Array<{
    config: any;
    data: any;
    options: any;
    plugins: any[];
    activeElements: unknown[];
    update: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setActiveElements: ReturnType<typeof vi.fn>;
  }> = [];

  class MockChart {
    config: any;
    data: any;
    options: any;
    plugins: any[];
    activeElements: unknown[] = [];
    update = vi.fn();
    destroy = vi.fn();
    setActiveElements = vi.fn((elements: unknown[]) => {
      this.activeElements = elements;
    });

    constructor(_canvas: unknown, config: any) {
      this.config = config;
      this.data = config.data;
      this.options = config.options;
      this.plugins = config.plugins;
      instances.push(this);
    }
  }

  return { instances, MockChart };
})();

interface Row {
  readonly day: string;
  readonly a: number;
  readonly b: number;
  readonly partial: boolean;
}

const ROWS: readonly Row[] = [
  { day: '01', a: 10, b: 5, partial: true },
  { day: '02', a: 20, b: 15, partial: false },
  { day: '03', a: 30, b: 25, partial: false },
  { day: '04', a: 40, b: 35, partial: true }
];

const SERIES_A: LineSeries<Row> = { key: 'a', label: 'Serie A', color: 'chart-1', value: (row) => row.a };
const SERIES_B: LineSeries<Row> = { key: 'b', label: 'Serie B', color: 'chart-5', value: (row) => row.b };

// Il test passa anche dal controllo dei template: `[points]` e le funzioni
// devono concordare su `Row`, altrimenti il componente non compila.
@Component({
  imports: [LineChart],
  template: `
    <app-line-chart
      [points]="points()"
      [series]="series()"
      [xLabel]="xLabel"
      [marker]="marker"
      valueAxis="amount"
      ariaLabel="Andamento di prova"
      [(selectedIndex)]="selected"
    >
      <p class="projected">Tooltip della feature</p>
    </app-line-chart>
  `
})
class HostComponent {
  readonly points = signal<readonly Row[]>(ROWS);
  readonly series = signal<readonly LineSeries<Row>[]>([SERIES_A, SERIES_B]);
  readonly selected = signal<number | null>(null);
  readonly xLabel = (row: Row): string => `g${row.day}`;
  readonly marker = (row: Row): LinePointMarker => (row.partial ? 'hollow' : 'auto');
}

describe('LineChart', () => {
  let fixture: ComponentFixture<HostComponent>;
  let appTheme: WritableSignal<'light' | 'dark'>;

  const chart = () => chartMocks.instances.at(-1)!;
  const lineChartElement = (): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector('app-line-chart')!;
  const canvas = (): HTMLCanvasElement => lineChartElement().querySelector('canvas')!;
  const guides = () => chart().options.plugins.lineGuides;
  const at = (index: number) => [
    { datasetIndex: 0, index },
    { datasetIndex: 1, index }
  ];

  const render = async (): Promise<void> => {
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  };

  const hover = async (index: number | null): Promise<void> => {
    chart().options.onHover({}, index === null ? [] : at(index));
    await fixture.whenStable();
  };

  const click = async (index: number): Promise<void> => {
    chart().options.onClick({}, at(index));
    await fixture.whenStable();
  };

  const key = async (name: string): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent('keydown', { key: name, cancelable: true });
    canvas().dispatchEvent(event);
    await fixture.whenStable();
    return event;
  };

  const dispatch = async (target: HTMLElement, type: string): Promise<void> => {
    target.dispatchEvent(new Event(type));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    chartMocks.instances.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D
    );
    appTheme = signal<'light' | 'dark'>('light');
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: ThemeStore, useValue: { theme: appTheme } },
        { provide: CHART_CONSTRUCTOR, useValue: chartMocks.MockChart }
      ]
    }).compileComponents();
  });

  it('disegna un dataset per serie, con etichette e marcatori dati dalla feature', async () => {
    await render();

    const datasets = chart().data.datasets;
    expect(datasets.map((dataset: { label: string }) => dataset.label)).toEqual(['Serie A', 'Serie B']);
    expect(datasets[0].data).toEqual([10, 20, 30, 40]);
    expect(datasets[1].data).toEqual([5, 15, 25, 35]);
    expect(chart().data.labels).toEqual(['g01', 'g02', 'g03', 'g04']);

    expect(canvas().getAttribute('aria-label')).toBe('Andamento di prova');
    expect(canvas().getAttribute('tabindex')).toBe('0');
    expect(canvas().getAttribute('role')).toBe('img');
  });

  it('distingue il fondo dei punti vuoti quando il tema lo definisce', async () => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    lineChartElement().style.setProperty('--color-surface', 'rgb(1, 1, 1)');
    lineChartElement().style.setProperty('--color-chart-1', 'rgb(2, 2, 2)');
    appTheme.set('dark');
    await fixture.whenStable();

    const fills = chart().data.datasets[0].pointBackgroundColor;
    expect(fills).toEqual(['rgb(1, 1, 1)', 'rgb(2, 2, 2)', 'rgb(2, 2, 2)', 'rgb(1, 1, 1)']);
  });

  it('il passaggio evidenzia il punto su tutte le serie; uscire dall’host toglie l’hover e tiene la selezione', async () => {
    await render();
    await click(1);
    await hover(2);

    expect(chart().activeElements).toEqual(at(2));
    expect(guides()).toMatchObject({ selected: 1, hover: 2 });

    await dispatch(lineChartElement(), 'pointerleave');

    expect(guides()).toMatchObject({ selected: 1, hover: null });
    expect(chart().activeElements).toEqual(at(1));
    expect(fixture.componentInstance.selected()).toBe(1);
  });

  it('il click seleziona, un secondo click sullo stesso punto deseleziona, altrove sposta', async () => {
    await render();

    await hover(1);
    await click(1);
    expect(fixture.componentInstance.selected()).toBe(1);

    await click(1);
    expect(fixture.componentInstance.selected()).toBeNull();

    await click(1);
    await hover(3);
    await click(3);
    expect(fixture.componentInstance.selected()).toBe(3);
    expect(guides()).toMatchObject({ selected: 3, hover: 3 });
  });

  it('un click fuori dai punti deseleziona', async () => {
    await render();
    await click(2);

    chart().options.onClick({}, []);
    await fixture.whenStable();

    expect(fixture.componentInstance.selected()).toBeNull();
  });

  it('la selezione impostata dalla feature arriva alle guide e agli elementi attivi', async () => {
    await render();

    fixture.componentInstance.selected.set(2);
    await fixture.whenStable();

    expect(guides()).toMatchObject({ selected: 2, hover: null });
    expect(chart().activeElements).toEqual(at(2));
  });

  it('da tastiera frecce, Home ed End spostano hover e selezione entro i limiti', async () => {
    await render();

    const right = await key('ArrowRight');
    expect(right.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.selected()).toBe(1);
    expect(guides()).toMatchObject({ selected: 1, hover: 1 });
    expect(chart().activeElements).toEqual(at(1));

    await key('End');
    expect(fixture.componentInstance.selected()).toBe(3);

    // Oltre l'ultimo punto non si va.
    await key('ArrowRight');
    expect(fixture.componentInstance.selected()).toBe(3);

    await key('Home');
    expect(fixture.componentInstance.selected()).toBe(0);

    // Né prima del primo.
    await key('ArrowLeft');
    expect(fixture.componentInstance.selected()).toBe(0);
    expect(guides()).toMatchObject({ selected: 0, hover: 0 });
  });

  it('Escape toglie la selezione; gli altri tasti non vengono intercettati', async () => {
    await render();
    await key('ArrowRight');

    const other = await key('a');
    expect(other.defaultPrevented).toBe(false);
    expect(fixture.componentInstance.selected()).toBe(1);

    await key('Escape');
    expect(fixture.componentInstance.selected()).toBeNull();
  });

  it('il focus seleziona il primo punto se non c’è selezione, altrimenti la tiene', async () => {
    await render();

    await dispatch(canvas(), 'focus');
    expect(fixture.componentInstance.selected()).toBe(0);

    await dispatch(canvas(), 'blur');
    fixture.componentInstance.selected.set(2);
    await fixture.whenStable();
    await dispatch(canvas(), 'focus');
    expect(fixture.componentInstance.selected()).toBe(2);
  });

  it('il blur toglie l’hover e tiene la selezione', async () => {
    await render();
    await key('ArrowRight');

    await dispatch(canvas(), 'blur');

    expect(guides()).toMatchObject({ selected: 1, hover: null });
    expect(fixture.componentInstance.selected()).toBe(1);
  });

  it('dopo hover e click, un aggiornamento serie non ripristina il punto da tastiera obsoleto', async () => {
    await render();
    fixture.componentInstance.series.set([SERIES_A]);
    await fixture.whenStable();
    await dispatch(canvas(), 'focus');
    await key('ArrowRight');

    chart().options.onHover({}, [{ datasetIndex: 0, index: 2 }]);
    await fixture.whenStable();
    chart().options.onClick({}, [{ datasetIndex: 0, index: 2 }]);
    await fixture.whenStable();
    expect(chart().activeElements).toEqual([{ datasetIndex: 0, index: 2 }]);

    fixture.componentInstance.series.set([SERIES_A, SERIES_B]);
    await fixture.whenStable();

    expect(chart().data.datasets).toHaveLength(2);
    expect(chart().activeElements).toEqual(at(2));
  });

  it('la scala Y non cambia con l’hover, ma segue i dati', async () => {
    await render();
    const yRange = () => {
      const { min, max } = chart().options.scales.y;
      return { min, max };
    };
    const initial = yRange();

    await hover(2);
    await hover(null);
    expect(yRange()).toEqual(initial);

    fixture.componentInstance.series.set([{ ...SERIES_A, value: (row) => row.a * 100 }]);
    await fixture.whenStable();
    expect(yRange().max).toBeGreaterThan(initial.max);
  });

  it('usa i plugin condivisi e non ricrea il grafico tra un hover e l’altro', async () => {
    await render();

    await hover(0);
    await hover(1);
    await click(1);
    await hover(null);

    expect(chartMocks.instances).toHaveLength(1);
    expect(chart().plugins).toEqual([...LINE_CHART_PLUGINS]);
  });

  it('risolve i colori dai token sull’host e li aggiorna al cambio di tema sulla stessa istanza', async () => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    lineChartElement().style.setProperty('--color-border', 'rgb(10, 20, 30)');
    lineChartElement().style.setProperty('--color-chart-1', 'rgb(40, 50, 60)');
    // Il primo render ha già letto lo stile: serve un cambio di tema per rileggerlo.
    appTheme.set('dark');
    await fixture.whenStable();
    const instance = chart();

    expect(instance.options.scales.y.grid.color).toBe('rgb(10, 20, 30)');
    expect(instance.data.datasets[0].borderColor).toBe('rgb(40, 50, 60)');

    lineChartElement().style.setProperty('--color-border', 'rgb(70, 80, 90)');
    lineChartElement().style.setProperty('--color-chart-1', 'rgb(100, 110, 120)');
    appTheme.set('light');
    await fixture.whenStable();

    expect(chartMocks.instances).toHaveLength(1);
    expect(instance.options.scales.y.grid.color).toBe('rgb(70, 80, 90)');
    expect(instance.data.datasets[0].borderColor).toBe('rgb(100, 110, 120)');
  });

  it('proietta il contenuto della feature dentro l’host', async () => {
    await render();

    expect(lineChartElement().querySelector('.projected')?.textContent).toContain(
      'Tooltip della feature'
    );
  });

  it('senza punti la tastiera non fa nulla e non lancia', async () => {
    await render();
    fixture.componentInstance.points.set([]);
    await fixture.whenStable();

    for (const name of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      const event = await key(name);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(fixture.componentInstance.selected()).toBeNull();
    expect(chart().data.labels).toEqual([]);
  });
});
