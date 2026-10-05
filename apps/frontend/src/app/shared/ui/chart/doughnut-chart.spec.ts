import { Component, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ThemeStore } from '../../../core/theme';
import { CHART_CONSTRUCTOR, DoughnutCenter, DoughnutChart } from './doughnut-chart';
import type { DoughnutSlice, SliceColor } from './doughnut-chart.model';

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

interface Entry {
  readonly name: string;
  readonly amount: number;
  readonly color: SliceColor;
}

// Sette voci con topN 5: le ultime due finiscono in «Altre 2 categorie».
const ENTRIES: readonly Entry[] = [
  { name: 'Casa', amount: 70, color: { custom: 'rgb(9, 9, 9)' } },
  { name: 'Spesa', amount: 60, color: 'chart-1' },
  { name: 'Auto', amount: 50, color: 'chart-2' },
  { name: 'Svago', amount: 40, color: 'chart-3' },
  { name: 'Salute', amount: 30, color: 'chart-4' },
  { name: 'Regali', amount: 20, color: 'chart-5' },
  { name: 'Varie', amount: 10, color: 'chart-1' }
];

// Il test passa anche dal controllo dei template: `[items]` e le funzioni devono
// concordare su `Entry`, altrimenti non compila. Il contesto del centro invece
// resta tipizzato alla larga: Angular non ricava `T` di `DoughnutCenter` dal
// contenuto proiettato, quindi `slice` qui non è controllato contro `Entry`.
@Component({
  imports: [DoughnutChart, DoughnutCenter],
  template: `
    <app-doughnut-chart
      [items]="items()"
      [value]="value"
      [label]="label"
      [color]="color"
      [topN]="5"
      ariaLabel="Ciambella di prova"
      (sliceActivated)="activated.push($event)"
    >
      <ng-template appDoughnutCenter let-slice>
        <span class="probe">{{
          slice === null ? 'nessuna' : slice.kind === 'item' ? slice.item.name : 'Altri'
        }}</span>
      </ng-template>
    </app-doughnut-chart>
  `
})
class HostComponent {
  readonly items = signal<readonly Entry[]>(ENTRIES);
  readonly activated: DoughnutSlice<Entry>[] = [];
  readonly value = (entry: Entry): number => entry.amount;
  readonly label = (entry: Entry): string => entry.name;
  readonly color = (entry: Entry): SliceColor => entry.color;
}

describe('DoughnutChart', () => {
  let fixture: ComponentFixture<HostComponent>;
  let appTheme: WritableSignal<'light' | 'dark'>;

  const chart = () => chartMocks.instances.at(-1)!;
  const host = (): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector('app-doughnut-chart')!;
  const canvas = (): HTMLCanvasElement => host().querySelector('canvas')!;
  const center = (): string => host().querySelector('.center')?.textContent?.trim() ?? '';
  const activated = () => fixture.componentInstance.activated;
  const at = (index: number) => [{ datasetIndex: 0, index }];

  const render = async (): Promise<void> => {
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  };

  const hover = async (index: number | null): Promise<void> => {
    chart().options.onHover({}, index === null ? [] : at(index));
    await fixture.whenStable();
  };

  const click = async (index: number | null): Promise<void> => {
    chart().options.onClick({}, index === null ? [] : at(index));
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

  // Un evento `focus` sintetico non rende l'elemento `:focus-visible`: si
  // simula quel che il browser dice di un focus arrivato da tastiera.
  const keyboardFocus = async (): Promise<void> => {
    const target = canvas();
    const matches = target.matches.bind(target);
    vi.spyOn(target, 'matches').mockImplementation(
      (selector: string) => selector === ':focus-visible' || matches(selector)
    );
    await dispatch(target, 'focus');
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

  it('disegna le prime 5 voci più «Altre 2 categorie», con un solo punto di tabulazione accessibile', async () => {
    await render();

    expect(chart().config.type).toBe('doughnut');
    expect(chart().data.labels).toEqual(['Casa', 'Spesa', 'Auto', 'Svago', 'Salute', 'Altre 2 categorie']);
    expect(chart().data.datasets[0].data).toEqual([70, 60, 50, 40, 30, 30]);
    expect(chart().plugins).toEqual([]);

    expect(canvas().getAttribute('tabindex')).toBe('0');
    expect(canvas().getAttribute('role')).toBe('img');
    expect(canvas().getAttribute('aria-label')).toBe('Ciambella di prova');
    expect(host().querySelector('.center')?.getAttribute('aria-live')).toBe('polite');
    expect(center()).toBe('nessuna');
  });

  it('il primo disegno ha già i colori del tema: niente fotogramma senza colori', async () => {
    const computed = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => (name === '--color-chart-1' ? 'rgb(1, 1, 1)' : '')
    } as CSSStyleDeclaration);
    try {
      await render();
    } finally {
      computed.mockRestore();
    }

    // La configurazione passata al costruttore è quella del primo disegno.
    expect(chartMocks.instances).toHaveLength(1);
    expect(chart().config.data.datasets[0].backgroundColor[1]).toBe('rgb(1, 1, 1)');
  });

  it('il passaggio attiva la fetta e la mostra al centro; uscire dall’host la toglie', async () => {
    await render();

    await hover(2);
    expect(chart().activeElements).toEqual(at(2));
    expect(center()).toBe('Auto');

    await dispatch(host(), 'pointerleave');
    expect(center()).toBe('nessuna');
    expect(chart().activeElements).toEqual([]);
  });

  it('l’hover non ricrea il grafico né riassegna dati e opzioni', async () => {
    await render();
    const { data, options } = chart();

    await hover(1);
    await hover(3);
    await hover(null);

    expect(chartMocks.instances).toHaveLength(1);
    expect(chart().data).toBe(data);
    expect(chart().options).toBe(options);
  });

  it('il click emette la fetta sotto il puntatore; fuori dalle fette non emette', async () => {
    await render();

    await click(1);
    expect(activated()).toEqual([{ kind: 'item', item: ENTRIES[1], value: 60 }]);

    await click(5);
    expect(activated()[1]).toEqual({ kind: 'others', items: [ENTRIES[5], ENTRIES[6]], value: 30 });

    await click(null);
    expect(activated()).toHaveLength(2);
  });

  it('il focus da tastiera attiva la prima fetta; le frecce girano in cerchio', async () => {
    await render();

    await keyboardFocus();
    expect(center()).toBe('Casa');
    expect(chart().activeElements).toEqual(at(0));

    for (let step = 0; step < 6; step++) {
      const event = await key('ArrowRight');
      expect(event.defaultPrevented).toBe(true);
    }
    expect(chart().activeElements).toEqual(at(0));

    await key('ArrowLeft');
    expect(chart().activeElements).toEqual(at(5));
    expect(center()).toBe('Altri');

    await key('Home');
    expect(chart().activeElements).toEqual(at(0));

    await key('End');
    expect(chart().activeElements).toEqual(at(5));

    await key('ArrowDown');
    expect(chart().activeElements).toEqual(at(0));

    await key('ArrowUp');
    expect(chart().activeElements).toEqual(at(5));

    await key('ArrowUp');
    expect(chart().activeElements).toEqual(at(4));
  });

  it('il focus dato col puntatore non attiva fette: uscendo non resta la più grande', async () => {
    await render();

    await dispatch(canvas(), 'focus');
    expect(center()).toBe('nessuna');
    expect(chart().activeElements).toEqual([]);

    await hover(2);
    await dispatch(host(), 'pointerleave');
    expect(center()).toBe('nessuna');
  });

  it('senza fetta attiva, → va alla prima e ← all’ultima', async () => {
    await render();
    await key('ArrowRight');
    expect(chart().activeElements).toEqual(at(0));

    await key('Escape');
    await key('ArrowLeft');
    expect(chart().activeElements).toEqual(at(5));
  });

  it('la tastiera riparte dalla fetta mostrata e prende il posto dell’hover', async () => {
    await render();
    await hover(3);

    await key('ArrowRight');
    expect(chart().activeElements).toEqual(at(4));
    expect(center()).toBe('Salute');

    // L'hover è stato tolto: uscire dall'host non riporta a nulla, resta la scelta da tastiera.
    await dispatch(host(), 'pointerleave');
    expect(center()).toBe('Salute');
  });

  it('Invio e Spazio emettono la fetta attiva e bloccano il comportamento predefinito', async () => {
    await render();
    await keyboardFocus();
    await key('ArrowRight');

    const enter = await key('Enter');
    expect(enter.defaultPrevented).toBe(true);
    expect(activated()).toEqual([{ kind: 'item', item: ENTRIES[1], value: 60 }]);

    await key('End');
    const space = await key(' ');
    expect(space.defaultPrevented).toBe(true);
    expect(activated()[1]).toMatchObject({ kind: 'others' });

    const other = await key('a');
    expect(other.defaultPrevented).toBe(false);
  });

  it('Invio senza fetta attiva non emette', async () => {
    await render();

    const enter = await key('Enter');

    expect(enter.defaultPrevented).toBe(false);
    expect(activated()).toEqual([]);
  });

  it('Escape e blur tolgono la fetta attiva', async () => {
    await render();
    await keyboardFocus();
    await key('ArrowRight');

    await key('Escape');
    expect(center()).toBe('nessuna');
    expect(chart().activeElements).toEqual([]);

    await key('ArrowRight');
    await hover(2);
    await dispatch(canvas(), 'blur');
    expect(center()).toBe('nessuna');
    expect(chart().activeElements).toEqual([]);
  });

  it('se le voci si riducono, l’indice da tastiera fuori dalle fette si scarta', async () => {
    await render();
    await keyboardFocus();
    await key('End');
    expect(center()).toBe('Altri');

    fixture.componentInstance.items.set(ENTRIES.slice(0, 2));
    await fixture.whenStable();

    expect(chart().data.labels).toEqual(['Casa', 'Spesa']);
    expect(center()).toBe('nessuna');
    expect(chart().activeElements).toEqual([]);

    // L'indice è stato azzerato, non solo nascosto: ridando le voci resta nessuna.
    fixture.componentInstance.items.set(ENTRIES);
    await fixture.whenStable();
    expect(center()).toBe('nessuna');
  });

  it('al cambio di tema ricrea i dati coi nuovi token e lascia com’è il colore custom', async () => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    host().style.setProperty('--color-chart-1', 'rgb(1, 1, 1)');
    host().style.setProperty('--color-surface', 'rgb(2, 2, 2)');
    appTheme.set('dark');
    await fixture.whenStable();
    const instance = chart();
    const before = instance.data;

    expect(before.datasets[0].backgroundColor[0]).toBe('rgb(9, 9, 9)');
    expect(before.datasets[0].backgroundColor[1]).toBe('rgb(1, 1, 1)');
    expect(before.datasets[0].borderColor).toBe('rgb(2, 2, 2)');

    host().style.setProperty('--color-chart-1', 'rgb(3, 3, 3)');
    appTheme.set('light');
    await fixture.whenStable();

    expect(chartMocks.instances).toHaveLength(1);
    expect(instance.data).not.toBe(before);
    expect(instance.data.datasets[0].backgroundColor[0]).toBe('rgb(9, 9, 9)');
    expect(instance.data.datasets[0].backgroundColor[1]).toBe('rgb(3, 3, 3)');
  });

  it('senza voci positive nessun tasto emette o cambia stato', async () => {
    await render();
    fixture.componentInstance.items.set([
      { name: 'Rimborso', amount: -10, color: 'chart-1' },
      { name: 'Zero', amount: 0, color: 'chart-2' }
    ]);
    await fixture.whenStable();
    expect(chart().data.labels).toEqual([]);

    await keyboardFocus();
    for (const name of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' ']) {
      const event = await key(name);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(activated()).toEqual([]);
    expect(center()).toBe('nessuna');
    expect(chart().activeElements).toEqual([]);
  });
});
