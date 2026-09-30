import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Chart, registry } from 'chart.js';
import { AppChart, CHART_CONSTRUCTOR, type AppChartType } from './chart';

// Il costruttore finto entra tramite `CHART_CONSTRUCTOR` e non con
// `vi.mock('chart.js')`: il builder esegue le spec senza isolamento e mette
// `AppChart` in un chunk condiviso, per cui il mock di una spec non è
// garantito essere quello che vede il componente.
const chartMocks = (() => {
  const instances: Array<{
    config: any;
    data: any;
    options: any;
    activeElements: unknown[];
    update: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setActiveElements: ReturnType<typeof vi.fn>;
  }> = [];

  class MockChart {
    config: any;
    data: any;
    options: any;
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
      instances.push(this);
    }
  }

  return { instances, MockChart };
})();

/** Gli id registrati in un registro tipizzato di Chart.js, in ordine alfabetico. */
const registeredIds = (typedRegistry: object): string[] =>
  Object.keys((typedRegistry as { items: Record<string, unknown> }).items).sort();

describe('registrazione Chart.js', () => {
  it('registra esattamente i componenti dei grafici a linee e a ciambella', () => {
    expect(registeredIds(registry.controllers)).toEqual(['doughnut', 'line']);
    expect(registeredIds(registry.elements)).toEqual(['arc', 'line', 'point']);
    expect(registeredIds(registry.scales)).toEqual(['category', 'linear']);
    expect(registeredIds(registry.plugins)).toEqual([]);
  });

  it('senza override il componente usa il costruttore Chart di Chart.js', () => {
    expect(TestBed.inject(CHART_CONSTRUCTOR)).toBe(Chart);
  });
});

describe('AppChart', () => {
  let fixture: ComponentFixture<AppChart<AppChartType>>;

  const chart = () => chartMocks.instances.at(-1)!;

  beforeEach(async () => {
    chartMocks.instances.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D
    );
    await TestBed.configureTestingModule({
      imports: [AppChart],
      providers: [{ provide: CHART_CONSTRUCTOR, useValue: chartMocks.MockChart }]
    }).compileComponents();
  });

  it('crea il grafico con gli input impostati prima del lifecycle della view', () => {
    fixture = TestBed.createComponent(AppChart);
    const data = { labels: ['A'], datasets: [{ data: [4] }] };
    const options = { responsive: true };
    const plugins = [{ id: 'feature-plugin' }];
    fixture.componentRef.setInput('type', 'line');
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('plugins', plugins);
    fixture.componentRef.setInput('ariaLabel', 'Valori per periodo');
    fixture.componentRef.setInput('tabIndex', 0);

    fixture.detectChanges();

    expect(chart().config.type).toBe('line');
    expect(chart().data).toBe(data);
    expect(chart().config.options.responsive).toBe(true);
    expect(chart().config.plugins).toEqual(plugins);
    expect(fixture.nativeElement.querySelector('canvas').getAttribute('aria-label')).toBe(
      'Valori per periodo'
    );
    expect(fixture.nativeElement.querySelector('canvas').getAttribute('tabindex')).toBe('0');
  });

  it('aggiorna dati, opzioni ed elementi attivi sulla stessa istanza', async () => {
    fixture = TestBed.createComponent(AppChart);
    fixture.componentRef.setInput('type', 'line');
    fixture.componentRef.setInput('data', { labels: ['A'], datasets: [{ data: [4] }] });
    fixture.componentRef.setInput('ariaLabel', 'Valori');
    fixture.detectChanges();
    const instance = chart();

    const nextData = { labels: ['B', 'C'], datasets: [{ data: [8, 9] }] };
    fixture.componentRef.setInput('data', nextData);
    fixture.componentRef.setInput('options', { responsive: false });
    fixture.componentRef.setInput('activeElements', [{ datasetIndex: 0, index: 1 }]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(chartMocks.instances).toHaveLength(1);
    expect(instance.data).toBe(nextData);
    expect(instance.options.responsive).toBe(false);
    expect(instance.setActiveElements).toHaveBeenLastCalledWith([{ datasetIndex: 0, index: 1 }]);
    expect(instance.update).toHaveBeenCalledWith('none');
  });

  it('toglie gli elementi attivi prima di cambiare i dati e li riapplica solo dopo l’update', async () => {
    fixture = TestBed.createComponent(AppChart);
    fixture.componentRef.setInput('type', 'line');
    fixture.componentRef.setInput('data', { labels: ['A', 'B', 'C'], datasets: [{ data: [1, 2, 3] }] });
    fixture.componentRef.setInput('activeElements', [{ datasetIndex: 0, index: 2 }]);
    fixture.componentRef.setInput('ariaLabel', 'Valori');
    fixture.detectChanges();
    const instance = chart();
    const calls: string[] = [];
    instance.setActiveElements.mockImplementation((elements: unknown[]) => {
      calls.push(`active:${JSON.stringify(elements)}:${instance.data.labels.length}`);
    });
    instance.update.mockImplementation(() => calls.push('update'));

    fixture.componentRef.setInput('data', { labels: ['A', 'B'], datasets: [{ data: [1, 2] }] });
    fixture.componentRef.setInput('activeElements', [
      { datasetIndex: 0, index: 1 },
      { datasetIndex: 0, index: 2 },
      { datasetIndex: 1, index: 0 }
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(calls).toEqual([
      'active:[]:3',
      'update',
      'active:[{"datasetIndex":0,"index":1}]:2',
      'update'
    ]);
  });

  it('cambiando solo gli elementi attivi non riassegna dati né opzioni', async () => {
    fixture = TestBed.createComponent(AppChart);
    fixture.componentRef.setInput('type', 'line');
    fixture.componentRef.setInput('data', { labels: ['A', 'B'], datasets: [{ data: [4, 8] }] });
    fixture.componentRef.setInput('ariaLabel', 'Valori');
    fixture.detectChanges();
    const instance = chart();
    const data = instance.data;
    const options = instance.options;
    instance.setActiveElements.mockClear();
    instance.update.mockClear();

    fixture.componentRef.setInput('activeElements', [
      { datasetIndex: 0, index: 1 },
      { datasetIndex: 0, index: 5 }
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(instance.data).toBe(data);
    expect(instance.options).toBe(options);
    expect(instance.setActiveElements).toHaveBeenCalledOnce();
    expect(instance.setActiveElements).toHaveBeenCalledWith([{ datasetIndex: 0, index: 1 }]);
    expect(instance.update).toHaveBeenCalledOnce();
    expect(instance.update).toHaveBeenCalledWith('none');
  });

  it('svuota gli elementi attivi quando la lista torna vuota', async () => {
    fixture = TestBed.createComponent(AppChart);
    fixture.componentRef.setInput('type', 'line');
    fixture.componentRef.setInput('data', { labels: ['A', 'B'], datasets: [{ data: [4, 8] }] });
    fixture.componentRef.setInput('activeElements', [{ datasetIndex: 0, index: 1 }]);
    fixture.componentRef.setInput('ariaLabel', 'Valori');
    fixture.detectChanges();
    const instance = chart();
    instance.setActiveElements.mockClear();

    fixture.componentRef.setInput('activeElements', []);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(instance.setActiveElements).toHaveBeenCalledWith([]);
    expect(instance.activeElements).toEqual([]);
  });

  it('riapplica l’input activeElements dichiarato dopo un hover e un update dati', async () => {
    fixture = TestBed.createComponent(AppChart);
    const declared = [{ datasetIndex: 0, index: 1 }];
    fixture.componentRef.setInput('type', 'line');
    fixture.componentRef.setInput('data', { labels: ['A', 'B'], datasets: [{ data: [4, 8] }] });
    fixture.componentRef.setInput('activeElements', declared);
    fixture.componentRef.setInput('ariaLabel', 'Valori');
    fixture.detectChanges();

    const instance = chart();
    const pointerActive = [{ datasetIndex: 0, index: 0 }];
    instance.activeElements = pointerActive;
    instance.options.onHover({}, pointerActive, instance);
    instance.options.onClick({}, pointerActive, instance);

    fixture.componentRef.setInput('data', {
      labels: ['A', 'B', 'C'],
      datasets: [{ data: [4, 8, 12] }]
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(instance.update).toHaveBeenCalledWith('none');
    expect(instance.activeElements).toEqual(declared);
  });

  it('con type doughnut crea il grafico di quel tipo e ne applica gli elementi attivi', async () => {
    fixture = TestBed.createComponent(AppChart);
    fixture.componentRef.setInput('type', 'doughnut');
    fixture.componentRef.setInput('data', { labels: ['A', 'B'], datasets: [{ data: [4, 6] }] });
    fixture.componentRef.setInput('activeElements', [{ datasetIndex: 0, index: 1 }]);
    fixture.componentRef.setInput('ariaLabel', 'Spese per categoria');
    fixture.detectChanges();
    const instance = chart();

    expect(instance.config.type).toBe('doughnut');
    expect(instance.setActiveElements).toHaveBeenCalledWith([{ datasetIndex: 0, index: 1 }]);

    fixture.componentRef.setInput('data', { labels: ['A'], datasets: [{ data: [4] }] });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(chartMocks.instances).toHaveLength(1);
    expect(instance.setActiveElements).not.toHaveBeenLastCalledWith([
      { datasetIndex: 0, index: 1 }
    ]);
    expect(instance.activeElements).toEqual([]);
  });

  it('emette indici delle interazioni e inoltra gli eventi accessibili del canvas', () => {
    fixture = TestBed.createComponent(AppChart);
    fixture.componentRef.setInput('type', 'line');
    fixture.componentRef.setInput('data', { labels: ['A'], datasets: [{ data: [4] }] });
    fixture.componentRef.setInput('ariaLabel', 'Valori');
    fixture.componentRef.setInput('tabIndex', 0);
    fixture.detectChanges();

    const hovered: unknown[] = [];
    const clicked: unknown[] = [];
    const keyDown: unknown[] = [];
    const focused: unknown[] = [];
    const blurred: unknown[] = [];
    fixture.componentInstance.hovered.subscribe((value) => hovered.push(value));
    fixture.componentInstance.clicked.subscribe((value) => clicked.push(value));
    fixture.componentInstance.keyDown.subscribe((value) => keyDown.push(value));
    fixture.componentInstance.focused.subscribe((value) => focused.push(value));
    fixture.componentInstance.blurred.subscribe((value) => blurred.push(value));

    const active = [{ datasetIndex: 2, index: 3 }];
    chart().options.onHover({}, active, chart());
    chart().options.onClick({}, active, chart());
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    const keyEvent = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    const focusEvent = new FocusEvent('focus');
    const blurEvent = new FocusEvent('blur');
    canvas.dispatchEvent(keyEvent);
    canvas.dispatchEvent(focusEvent);
    canvas.dispatchEvent(blurEvent);

    expect(hovered).toEqual([[{ datasetIndex: 2, index: 3 }]]);
    expect(clicked).toEqual([[{ datasetIndex: 2, index: 3 }]]);
    expect(keyDown).toEqual([keyEvent]);
    expect(focused).toEqual([focusEvent]);
    expect(blurred).toEqual([blurEvent]);
  });

  it('distrugge l’istanza quando il componente viene distrutto', () => {
    fixture = TestBed.createComponent(AppChart);
    fixture.componentRef.setInput('type', 'line');
    fixture.componentRef.setInput('data', { labels: ['A'], datasets: [{ data: [4] }] });
    fixture.componentRef.setInput('ariaLabel', 'Valori');
    fixture.detectChanges();
    const instance = chart();

    fixture.destroy();

    expect(instance.destroy).toHaveBeenCalledOnce();
  });
});