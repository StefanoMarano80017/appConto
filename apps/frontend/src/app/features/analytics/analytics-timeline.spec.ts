import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { CHART_CONSTRUCTOR, LineChart } from '../../shared/ui/chart/line-chart';
import { AnalyticsTimeline } from './analytics-timeline';
import { Timeline, TimelineBucket, TimelineGranularity } from './analytics.model';

// Il grafico vero e proprio (tratti, guide, tastiera, focus) è coperto da
// line-chart.spec.ts: qui basta un Chart.js finto che accetti di essere creato
// e che esponga `onClick`, per provare il collegamento dal click al riquadro.
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

const bucket = (
  period: string,
  income: number,
  expenses: number,
  partial = false
): TimelineBucket => ({
  period,
  partial,
  income,
  expenses,
  withdrawals: 0,
  loans: 0,
  transfers: 0,
  netMovement: income - expenses
});

const weekly = (): Timeline => ({
  granularity: 'week',
  buckets: [
    bucket('2026-06-29', 0, 120.5, true),
    bucket('2026-07-06', 1725, 340, false),
    bucket('2026-07-13', 0, 880.07, false),
    bucket('2026-07-20', 0, 546, true)
  ]
});

describe('AnalyticsTimeline', () => {
  let fixture: ComponentFixture<AnalyticsTimeline>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => (host().textContent ?? '').replace(/\./g, '');
  const tooltip = (): HTMLElement | null => host().querySelector<HTMLElement>('.tooltip');

  const lineChart = (): LineChart<TimelineBucket> =>
    fixture.debugElement.query(By.directive(LineChart)).componentInstance;
  const drawnKeys = (): string[] => lineChart().series().map((series) => series.key);
  const xLabels = (): string[] => {
    const label = lineChart().xLabel();
    return lineChart().points().map((point) => label(point));
  };

  const render = async (
    timeline: Timeline = weekly(),
    granularity: TimelineGranularity = 'week'
  ): Promise<void> => {
    fixture = TestBed.createComponent(AnalyticsTimeline);
    fixture.componentRef.setInput('timeline', timeline);
    fixture.componentRef.setInput('granularity', granularity);
    await fixture.whenStable();
  };

  /** Seleziona come farebbe il grafico: il model a due vie torna alla feature. */
  const select = async (index: number | null): Promise<void> => {
    lineChart().selectedIndex.set(index);
    await fixture.whenStable();
  };

  const toggleLegend = async (label: string): Promise<void> => {
    [...host().querySelectorAll<HTMLButtonElement>('.legend button')]
      .find((button) => button.textContent?.includes(label))
      ?.click();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    chartMocks.instances.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D
    );
    await TestBed.configureTestingModule({
      imports: [AnalyticsTimeline],
      providers: [{ provide: CHART_CONSTRUCTOR, useValue: chartMocks.MockChart }]
    }).compileComponents();
  });

  it('passa al grafico i bucket e una serie per entrata e una per uscita', async () => {
    await render();

    expect(lineChart().points()).toEqual(weekly().buckets);
    expect(lineChart().series().map((series) => series.label)).toEqual(['Entrate', 'Uscite']);
    expect(lineChart().valueAxis()).toBe('amount');
  });

  it('non disegna una serie senza valori di entrata', async () => {
    await render({
      granularity: 'week',
      buckets: [bucket('2026-07-06', 0, 125), bucket('2026-07-13', 0, 80)]
    });

    expect(drawnKeys()).toEqual(['expenses']);
  });

  it('non disegna una serie senza valori di uscita', async () => {
    await render({
      granularity: 'week',
      buckets: [bucket('2026-07-06', 125, 0), bucket('2026-07-13', 80, 0)]
    });

    expect(drawnKeys()).toEqual(['income']);
  });

  it('il saldo netto non è acceso di partenza, ma si può accendere', async () => {
    await render();
    expect(drawnKeys()).toEqual(['income', 'expenses']);

    await toggleLegend('Saldo netto');

    expect(drawnKeys()).toEqual(['income', 'expenses', 'net']);
  });

  it('mantiene ordine, valori e colori dichiarati per ogni serie', async () => {
    await render();
    await toggleLegend('Saldo netto');

    const series = lineChart().series();
    expect(series.map((item) => item.label)).toEqual(['Entrate', 'Uscite', 'Saldo netto']);
    expect(series.map((item) => item.color)).toEqual(['chart-1', 'chart-5', 'chart-3']);
    expect(series.map((item) => weekly().buckets.map((point) => item.value(point)))).toEqual([
      [0, 1725, 0, 0],
      [120.5, 340, 880.07, 546],
      [-120.5, 1385, -880.07, -546]
    ]);
    expect(
      [...host().querySelectorAll<HTMLElement>('.legend .key')].map(
        (swatch) => swatch.style.background
      )
    ).toEqual(['var(--color-chart-1)', 'var(--color-chart-5)', 'var(--color-chart-3)']);
  });

  it('la legenda è sempre presente: l\'identità non è solo il colore', async () => {
    await render();

    const labels = [...host().querySelectorAll('.legend button')].map((button) =>
      button.textContent?.trim()
    );

    expect(labels).toEqual(['Entrate', 'Uscite', 'Saldo netto']);
  });

  it('non si può nascondere l\'ultima serie visibile', async () => {
    await render();

    await toggleLegend('Entrate');
    await toggleLegend('Uscite');

    expect(drawnKeys()).toEqual(['expenses']);
  });

  it('segna gli intervalli incompleti con un punto vuoto', async () => {
    await render();

    const marker = lineChart().marker();
    expect(lineChart().points().map((point) => marker(point))).toEqual([
      'hollow',
      'auto',
      'auto',
      'hollow'
    ]);
    expect(text()).toContain('intervalli coperti solo in parte');
  });

  it('descrive il grafico per chi non lo vede, con un solo punto di tabulazione', async () => {
    await render();

    expect(lineChart().ariaLabel()).toBe(
      'Andamento nel tempo su 4 intervalli. I valori sono disponibili anche nella tabella.'
    );
    expect(host().querySelectorAll('[tabindex="0"]').length).toBe(1);
  });

  it('senza selezione nessun riquadro; selezionato un punto, mostra i valori del bucket', async () => {
    await render();
    expect(tooltip()).toBeNull();

    await select(1);

    const shown = (tooltip()?.textContent ?? '').replace(/\./g, '');
    expect(shown).toContain('settimana del 6 luglio');
    // Il segno, non solo la cifra: un'entrata e un'uscita non si distinguono
    // dal solo colore, e prima d'ora questa asserzione sarebbe passata anche
    // invertendo i due toni.
    expect(shown).toContain('+1725,00');
    expect(shown).toContain('−340,00');
    expect(tooltip()?.classList.contains('left-side')).toBe(false);
  });

  it('il click sul grafico arriva alla feature come selezione', async () => {
    await render();

    chartMocks.instances.at(-1)!.options.onClick({}, [
      { datasetIndex: 0, index: 2 },
      { datasetIndex: 1, index: 2 }
    ]);
    await fixture.whenStable();

    expect(host().querySelector('.when')?.textContent).toContain('settimana del 13 luglio');
  });

  // Il caso del round precedente: un bucket a rimborso netto (`expenses`
  // negativo) deve mostrare lo stesso segno nel riquadro al passaggio del
  // mouse e nella tabella. Prima di questo fix il riquadro passava da
  // `amountTone()` (tono forzato su un valore non negato) e la tabella da
  // `value()` (valore negato, tono auto): sullo stesso bucket rendevano segni
  // opposti.
  it('il riquadro e la tabella concordano sul segno di un rimborso netto', async () => {
    await render({
      granularity: 'week',
      buckets: [bucket('2026-07-06', 1000, 300, false), bucket('2026-07-13', 200, -50, false)]
    });

    await select(1);
    const tooltipExpenses = [...host().querySelectorAll('.tooltip li')]
      .find((li) => li.textContent?.includes('Uscite'))
      ?.querySelector('.amount')
      ?.textContent?.trim();

    host().querySelector<HTMLButtonElement>('.table-toggle')?.click();
    await fixture.whenStable();
    const rows = host().querySelectorAll('table.values tbody tr');
    const tableExpenses = rows[1]?.querySelectorAll('td.numeric')[1]?.textContent?.trim();

    expect(tooltipExpenses).toContain('+50,00');
    expect(tableExpenses).toContain('+50,00');
  });

  it('un intervallo incompleto lo dice anche nel riquadro', async () => {
    await render();
    await select(0);

    expect(tooltip()?.textContent).toContain('Intervallo incompleto');
  });

  it('il riquadro sta dentro il grafico, resta aperto al pointerleave e si chiude con X', async () => {
    await render();
    await select(1);
    expect(host().querySelector('app-line-chart .tooltip')).not.toBeNull();

    host().querySelector('app-line-chart')?.dispatchEvent(new Event('pointerleave'));
    await fixture.whenStable();
    expect(tooltip()).not.toBeNull();

    host().querySelector<HTMLButtonElement>('.tooltip-close')?.click();
    await fixture.whenStable();

    expect(tooltip()).toBeNull();
    expect(lineChart().selectedIndex()).toBeNull();
  });

  it('un\'altra selezione sposta il riquadro, Escape sul riquadro lo chiude', async () => {
    await render();
    await select(1);
    expect(host().querySelector('.when')?.textContent).toContain('settimana del 6 luglio');

    await select(2);
    expect(host().querySelector('.when')?.textContent).toContain('settimana del 13 luglio');

    tooltip()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    expect(tooltip()).toBeNull();
    expect(lineChart().selectedIndex()).toBeNull();
  });

  it('i valori sono leggibili anche in tabella, senza passare dal grafico', async () => {
    await render();

    expect(host().querySelector('table.values')).toBeNull();

    host().querySelector<HTMLButtonElement>('.table-toggle')?.click();
    await fixture.whenStable();

    const rows = host().querySelectorAll('table.values tbody tr');
    expect(rows.length).toBe(4);
    expect(text()).toContain('incompleto');

    // Il segno, sulla cella giusta: in questa riga (indice 2, income 0) il
    // saldo netto vale anch'esso -880,07, quindi un'asserzione sull'intera
    // fixture (`text()`) sarebbe passata anche con le uscite non negate —
    // esattamente il difetto che questa correzione doveva chiudere.
    const expensesCell = rows[2]?.querySelectorAll('td.numeric')[1];
    expect(expensesCell?.textContent?.replace(/\./g, '')).toContain('−880,07');
  });

  it('chiede il passo scelto senza cambiarlo da sé', async () => {
    await render();

    const emitted: TimelineGranularity[] = [];
    fixture.componentInstance.granularitySelected.subscribe((step) => emitted.push(step));

    [...host().querySelectorAll<HTMLButtonElement>('app-choice-group button')]
      .find((button) => button.textContent?.includes('Mese'))
      ?.click();

    expect(emitted).toEqual(['month']);
  });

  it('etichetta gli intervalli secondo il passo', async () => {
    await render(weekly(), 'week');
    expect(text()).toContain('settimana');
    expect(xLabels()).toEqual(['29/06', '06/07', '13/07', '20/07']);

    await render(
      { granularity: 'day', buckets: [bucket('2026-07-06', 10, 5), bucket('2026-07-07', 0, 9)] },
      'day'
    );
    expect(text()).toContain('giorno');
    expect(xLabels()).toEqual(['06/07', '07/07']);

    await render(
      { granularity: 'month', buckets: [bucket('2026-06', 1000, 500), bucket('2026-07', 0, 900)] },
      'month'
    );
    expect(text()).toContain('mese');
    expect(xLabels()).toEqual(['giu 26', 'lug 26']);
  });

  it('aggiorna le etichette quando cambia la granularità sulla stessa istanza', async () => {
    await render(weekly(), 'week');
    const before = lineChart().xLabel();

    fixture.componentRef.setInput('timeline', {
      granularity: 'month',
      buckets: [bucket('2026-06', 1000, 500), bucket('2026-07', 0, 900)]
    });
    fixture.componentRef.setInput('granularity', 'month');
    await fixture.whenStable();

    expect(lineChart().xLabel()).not.toBe(before);
    expect(xLabels()).toEqual(['giu 26', 'lug 26']);
    expect(chartMocks.instances.at(-1)!.data.labels).toEqual(['giu 26', 'lug 26']);
  });

  it('un periodo senza movimenti lo dice, invece di disegnare il vuoto', async () => {
    await render({ granularity: 'week', buckets: [] });

    expect(text()).toContain('Nessun movimento nel periodo selezionato');
    expect(host().querySelector('app-line-chart')).toBeNull();
    expect(host().querySelector('canvas')).toBeNull();
    expect(host().querySelector('.legend')).toBeNull();
  });

  it('un solo intervallo resta leggibile', async () => {
    await render({ granularity: 'week', buckets: [bucket('2026-07-06', 100, 50)] });

    expect(drawnKeys()).toEqual(['income', 'expenses']);
    expect(host().querySelector('canvas')).not.toBeNull();

    await select(0);
    expect(tooltip()?.style.left).toBe('50%');
  });

  it('mantiene le uscite come magnitudine nel grafico e ne mostra il segno nel riquadro', async () => {
    await render();

    const expenses = lineChart()
      .series()
      .find((series) => series.key === 'expenses');
    await select(3);

    expect(expenses?.value(weekly().buckets[3]!)).toBe(546);
    expect(tooltip()?.textContent).toContain('−546,00');
    expect(tooltip()?.classList.contains('left-side')).toBe(true);
  });

  it('apre i movimenti sul periodo completo della settimana selezionata', async () => {
    await render();
    const requested: { from: string | null; to: string | null }[] = [];
    fixture.componentInstance.transactionsRequested.subscribe((range) => requested.push(range));
    await select(1);

    host().querySelector<HTMLButtonElement>('.tooltip-action')?.click();

    expect(requested).toEqual([{ from: '2026-07-06', to: '2026-07-12' }]);
  });

  it('apre i movimenti dal primo all’ultimo giorno del mese selezionato', async () => {
    await render(
      {
        granularity: 'month',
        buckets: [bucket('2026-02', 300, 100)]
      },
      'month'
    );
    const requested: { from: string | null; to: string | null }[] = [];
    fixture.componentInstance.transactionsRequested.subscribe((range) => requested.push(range));
    await select(0);

    host().querySelector<HTMLButtonElement>('.tooltip-action')?.click();

    expect(requested).toEqual([{ from: '2026-02-01', to: '2026-02-28' }]);
  });

  // La pagina cambia subito il passo ma tiene i bucket vecchi finché arrivano
  // i nuovi: un `YYYY-MM` letto come giorno era una data non valida (e un
  // RangeError di Intl). I bucket si leggono col passo dei dati.
  it('legge i bucket col passo dei dati, anche se il passo scelto è già un altro', async () => {
    await render(
      { granularity: 'month', buckets: [bucket('2026-06', 1000, 500), bucket('2026-07', 0, 900)] },
      'day'
    );

    expect(xLabels()).toEqual(['giu 26', 'lug 26']);

    host().querySelector<HTMLButtonElement>('.table-toggle')?.click();
    await fixture.whenStable();
    const rowLabels = [...host().querySelectorAll('table.values tbody th')].map((th) =>
      th.textContent?.trim()
    );
    expect(rowLabels).toEqual(['giugno 2026', 'luglio 2026']);

    const requested: { from: string | null; to: string | null }[] = [];
    fixture.componentInstance.transactionsRequested.subscribe((range) => requested.push(range));
    await select(1);
    expect(host().querySelector('.when')?.textContent).toContain('luglio 2026');

    host().querySelector<HTMLButtonElement>('.tooltip-action')?.click();

    expect(requested).toEqual([{ from: '2026-07-01', to: '2026-07-31' }]);
  });

  it('intestazioni e totali della tabella seguono le serie', async () => {
    await render();
    host().querySelector<HTMLButtonElement>('.table-toggle')?.click();
    await fixture.whenStable();

    const headers = [...host().querySelectorAll('table.values thead th')].map((th) =>
      th.textContent?.trim()
    );
    expect(headers).toEqual(['Intervallo', 'Entrate', 'Uscite', 'Saldo netto']);

    const footer = [...host().querySelectorAll('table.values tfoot td')].map((td) =>
      (td.textContent ?? '').replace(/\./g, '').trim()
    );
    expect(footer[0]).toContain('+1725,00');
    expect(footer[1]).toContain('−1886,57');
    expect(footer[2]).toBe('');
  });
});
