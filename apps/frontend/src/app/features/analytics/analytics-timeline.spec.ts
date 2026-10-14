import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { CHART_CONSTRUCTOR, LineChart } from '@shared/ui/chart/line/line-chart';
import { AnalyticsTimeline, TimelineSelection } from './analytics-timeline';
import { Timeline, TimelineBucket, TimelineGranularity } from './analytics.model';

// Il grafico vero e proprio (tratti, guide, tastiera, focus) è coperto da
// line-chart.spec.ts: qui basta un Chart.js finto che accetti di essere creato
// e che esponga `onClick`, per provare il collegamento dal click al riquadro.
const chartMocks = (() => {
  const instances: Array<{ data: any; options: any; activeElements: any[] }> = [];

  class MockChart {
    data: any;
    options: any;
    activeElements: any[] = [];
    update(): void {}
    destroy(): void {}
    setActiveElements(elements: any[]): void {
      this.activeElements = elements;
    }

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
  partial = false,
): TimelineBucket => ({
  period,
  partial,
  income,
  expenses,
  withdrawals: 0,
  loans: 0,
  transfers: 0,
  netMovement: income - expenses,
});

const weekly = (): Timeline => ({
  granularity: 'week',
  buckets: [
    bucket('2026-06-29', 0, 120.5, true),
    bucket('2026-07-06', 1725, 340, false),
    bucket('2026-07-13', 0, 880.07, false),
    bucket('2026-07-20', 0, 546, true),
  ],
});

describe('AnalyticsTimeline', () => {
  let fixture: ComponentFixture<AnalyticsTimeline>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => (host().textContent ?? '').replace(/\./g, '');
  const tooltip = (): HTMLElement | null => host().querySelector<HTMLElement>('.tooltip');

  const lineChart = (): LineChart<TimelineBucket> =>
    fixture.debugElement.query(By.directive(LineChart)).componentInstance;
  const drawnKeys = (): string[] =>
    lineChart()
      .series()
      .map((series) => series.key);
  const xLabels = (): string[] => {
    const label = lineChart().xLabel();
    return lineChart()
      .points()
      .map((point) => label(point));
  };

  const render = async (
    timeline: Timeline = weekly(),
    granularity: TimelineGranularity = 'week',
  ): Promise<void> => {
    fixture = TestBed.createComponent(AnalyticsTimeline);
    fixture.componentRef.setInput('timeline', timeline);
    fixture.componentRef.setInput('granularity', granularity);
    await fixture.whenStable();
  };

  const updateTimeline = async (
    timeline: Timeline,
    granularity: TimelineGranularity = timeline.granularity,
  ): Promise<void> => {
    fixture.componentRef.setInput('timeline', timeline);
    fixture.componentRef.setInput('granularity', granularity);
    await fixture.whenStable();
  };

  /** Seleziona come farebbe il grafico: il model emette la modifica alla feature. */
  const select = async (index: number | null): Promise<void> => {
    lineChart().selectedIndex.set(index);
    await fixture.whenStable();
  };

  const clickPoint = async (index: number | null): Promise<void> => {
    chartMocks.instances
      .at(-1)!
      .options.onClick({}, index === null ? [] : [{ datasetIndex: 0, index }]);
    await fixture.whenStable();
  };

  const toggleLegend = async (label: string): Promise<void> => {
    [...host().querySelectorAll<HTMLButtonElement>('.legend button')]
      .find((button) => button.textContent?.includes(label))
      ?.click();
    await fixture.whenStable();
  };

  const viewButton = (label: 'Flussi' | 'Cumulato'): HTMLButtonElement => {
    const group = host().querySelector<HTMLElement>(
      '[role="group"][aria-label="Vista dell\'andamento"]',
    );
    const button = [...(group?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (candidate) => candidate.getAttribute('aria-label') === label,
    );

    if (!button) {
      throw new Error(`Pulsante della vista "${label}" non trovato`);
    }

    return button;
  };

  const granularityButton = (label: 'Giorno' | 'Settimana' | 'Mese'): HTMLButtonElement => {
    const group = host().querySelector<HTMLElement>(
      '[role="group"][aria-label="Passo dell\'andamento"]',
    );
    const button = [...(group?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (candidate) => candidate.textContent?.trim() === label,
    );

    if (!button) {
      throw new Error(`Pulsante della granularità "${label}" non trovato`);
    }

    return button;
  };

  const chooseView = async (label: 'Flussi' | 'Cumulato'): Promise<void> => {
    const button = viewButton(label);
    button.click();
    await fixture.whenStable();

    if (button.getAttribute('aria-pressed') !== 'true') {
      throw new Error(`La selezione della vista "${label}" non è avvenuta`);
    }
  };

  const chooseGranularity = async (label: 'Giorno' | 'Settimana' | 'Mese'): Promise<void> => {
    const button = granularityButton(label);
    button.click();
    await fixture.whenStable();
  };

  /** L'intestazione del pannello: il titolo del grafico, che cambia con la vista. */
  const chartTitle = (): string =>
    host().querySelector('app-section-header')?.textContent?.replace(/\s+/g, ' ') ?? '';

  /** Le righe del riquadro, come «etichetta: importo», nell'ordine in cui le mostra. */
  const tooltipLines = (): string[] =>
    [...host().querySelectorAll('.tooltip li')].map((li) => {
      const name = li.querySelector('.name')?.textContent?.trim();
      const amount = (li.querySelector('.amount')?.textContent ?? '')
        .replace(/\./g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return `${name}: ${amount}`;
    });

  beforeEach(async () => {
    chartMocks.instances.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
    await TestBed.configureTestingModule({
      imports: [AnalyticsTimeline],
      providers: [{ provide: CHART_CONSTRUCTOR, useValue: chartMocks.MockChart }],
    }).compileComponents();
  });

  it('passa al grafico i bucket e una serie per entrate, uscite e netto', async () => {
    await render();

    expect(lineChart().points()).toEqual(weekly().buckets);
    expect(
      lineChart()
        .series()
        .map((series) => series.label),
    ).toEqual(['Entrate', 'Uscite', 'Netto']);
    expect(lineChart().valueAxis()).toBe('amount');
  });

  it('non disegna una serie senza valori di entrata', async () => {
    await render({
      granularity: 'week',
      buckets: [bucket('2026-07-06', 0, 125), bucket('2026-07-13', 0, 80)],
    });

    expect(drawnKeys()).toEqual(['expenses', 'net']);
  });

  it('non disegna una serie senza valori di uscita', async () => {
    await render({
      granularity: 'week',
      buckets: [bucket('2026-07-06', 125, 0), bucket('2026-07-13', 80, 0)],
    });

    expect(drawnKeys()).toEqual(['income', 'net']);
  });

  it('il netto è acceso di partenza, ma si può spegnere e riaccendere', async () => {
    await render();
    expect(drawnKeys()).toEqual(['income', 'expenses', 'net']);

    await toggleLegend('Netto');
    expect(drawnKeys()).toEqual(['income', 'expenses']);

    await toggleLegend('Netto');
    expect(drawnKeys()).toEqual(['income', 'expenses', 'net']);
  });

  it('mantiene ordine, valori e colori dichiarati per ogni serie', async () => {
    await render();

    const series = lineChart().series();
    expect(series.map((item) => item.label)).toEqual(['Entrate', 'Uscite', 'Netto']);
    expect(series.map((item) => item.color)).toEqual(['chart-1', 'chart-5', 'chart-3']);
    expect(series.map((item) => weekly().buckets.map((point) => item.value(point)))).toEqual([
      [0, 1725, 0, 0],
      [120.5, 340, 880.07, 546],
      [-120.5, 1385, -880.07, -546],
    ]);
    expect(
      [...host().querySelectorAll<HTMLElement>('.legend .key')].map(
        (swatch) => swatch.style.background,
      ),
    ).toEqual(['var(--color-chart-1)', 'var(--color-chart-5)', 'var(--color-chart-3)']);
  });

  it("la legenda è sempre presente: l'identità non è solo il colore", async () => {
    await render();

    const labels = [...host().querySelectorAll('.legend button')].map((button) =>
      button.textContent?.trim(),
    );

    // «Netto», non «Saldo netto»: è `netMovement`, che conta anche
    // prelievi, trasferimenti e prestiti. «Saldo netto» resta il nome del KPI
    // (entrate meno uscite), di cui la vista cumulata («Saldo periodo») è la storia.
    expect(labels).toEqual(['Entrate', 'Uscite', 'Netto']);
  });

  it("non si può nascondere l'ultima serie visibile", async () => {
    await render();

    await toggleLegend('Entrate');
    await toggleLegend('Uscite');
    expect(drawnKeys()).toEqual(['net']);

    await toggleLegend('Netto');

    expect(drawnKeys()).toEqual(['net']);
  });

  it('segna gli intervalli incompleti con un punto vuoto', async () => {
    await render();

    const marker = lineChart().marker();
    expect(
      lineChart()
        .points()
        .map((point) => marker(point)),
    ).toEqual(['hollow', 'auto', 'auto', 'hollow']);
    expect(text()).toContain('intervalli coperti solo in parte');
  });

  it('descrive il grafico per chi non lo vede, con un solo punto di tabulazione', async () => {
    await render();

    expect(lineChart().ariaLabel()).toBe(
      'Andamento nel tempo su 4 intervalli.',
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

    await clickPoint(2);

    expect(host().querySelector('app-chart-tooltip h2')?.textContent).toContain(
      'settimana del 13 luglio',
    );
  });

  it('la selezione segue il periodo riordinato e l’indice evidenziato coincide col riquadro', async () => {
    await render();
    await select(1);

    await updateTimeline({
      granularity: 'week',
      buckets: [
        bucket('2026-07-13', 0, 200),
        bucket('2026-07-20', 0, 300),
        bucket('2026-07-06', 2222, 400),
      ],
    });

    expect(lineChart().selectedIndex()).toBe(2);
    expect(host().querySelector('app-chart-tooltip h2')?.textContent).toContain(
      'settimana del 6 luglio',
    );
    expect(tooltip()?.style.left).toBe('100%');
    expect(tooltip()?.classList.contains('left-side')).toBe(true);
    expect(chartMocks.instances.at(-1)?.activeElements).toEqual([
      { datasetIndex: 0, index: 2 },
      { datasetIndex: 1, index: 2 },
      { datasetIndex: 2, index: 2 },
    ]);
  });

  it('mantiene il periodo selezionato e aggiorna i valori del riquadro', async () => {
    await render();
    await select(1);

    await updateTimeline({
      granularity: 'week',
      buckets: [
        bucket('2026-06-29', 0, 120.5, true),
        bucket('2026-07-06', 2200, 410),
        bucket('2026-07-13', 0, 880.07, false),
        bucket('2026-07-20', 0, 546, true),
      ],
    });

    const shown = (tooltip()?.textContent ?? '').replace(/\./g, '');
    expect(lineChart().selectedIndex()).toBe(1);
    expect(host().querySelector('app-chart-tooltip h2')?.textContent).toContain(
      'settimana del 6 luglio',
    );
    expect(shown).toContain('+2200,00');
    expect(shown).toContain('−410,00');
  });

  it('chiude il riquadro quando il periodo scompare e non lo ripristina se ricompare', async () => {
    await render();
    await select(1);

    const withoutSelectedPeriod: Timeline = {
      granularity: 'week',
      buckets: [
        bucket('2026-06-29', 0, 120.5, true),
        bucket('2026-07-13', 0, 880.07, false),
        bucket('2026-07-20', 0, 546, true),
      ],
    };
    await updateTimeline(withoutSelectedPeriod);

    expect(lineChart().selectedIndex()).toBeNull();
    expect(tooltip()).toBeNull();

    await updateTimeline(weekly());

    expect(lineChart().selectedIndex()).toBeNull();
    expect(tooltip()).toBeNull();
  });

  it('non associa la selezione a un periodo uguale con granularità diversa', async () => {
    await render();
    await select(1);

    await updateTimeline({
      granularity: 'day',
      buckets: [bucket('2026-07-06', 100, 50), bucket('2026-07-07', 80, 20)],
    });

    expect(lineChart().selectedIndex()).toBeNull();
    expect(tooltip()).toBeNull();
  });

  it('ignora in sicurezza un indice non valido senza selezionare un altro bucket', async () => {
    await render();

    await clickPoint(100);

    expect(lineChart().selectedIndex()).toBeNull();
    expect(tooltip()).toBeNull();
  });

  it('il secondo click sul punto selezionato e Escape deselezionano', async () => {
    await render();
    await clickPoint(1);
    expect(host().querySelector('app-chart-tooltip h2')?.textContent).toContain(
      'settimana del 6 luglio',
    );

    await clickPoint(1);
    expect(lineChart().selectedIndex()).toBeNull();
    expect(tooltip()).toBeNull();

    await clickPoint(2);
    host()
      .querySelector('canvas')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    expect(lineChart().selectedIndex()).toBeNull();
    expect(tooltip()).toBeNull();
  });

  // Il caso del round precedente: un bucket a rimborso netto (`expenses`
  // negativo) deve mostrare nel riquadro il segno di un'entrata. Prima di
  // quel fix il riquadro passava da `amountTone()` (tono forzato su un valore
  // non negato) e rendeva il segno opposto. La tabella dei valori, con cui
  // lo si confrontava, non c'è più nel pannello: resta il riquadro, che legge
  // `rows` come la leggeva lei.
  it('il riquadro mostra il segno giusto di un rimborso netto', async () => {
    await render({
      granularity: 'week',
      buckets: [bucket('2026-07-06', 1000, 300, false), bucket('2026-07-13', 200, -50, false)],
    });

    await select(1);
    const tooltipExpenses = [...host().querySelectorAll('.tooltip li')]
      .find((li) => li.textContent?.includes('Uscite'))
      ?.querySelector('.amount')
      ?.textContent?.trim();

    expect(tooltipExpenses).toContain('+50,00');
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

  it("un'altra selezione sposta il riquadro, Escape sul riquadro lo chiude", async () => {
    await render();
    await select(1);
    expect(host().querySelector('app-chart-tooltip h2')?.textContent).toContain(
      'settimana del 6 luglio',
    );

    await select(2);
    expect(host().querySelector('app-chart-tooltip h2')?.textContent).toContain(
      'settimana del 13 luglio',
    );

    tooltip()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    expect(tooltip()).toBeNull();
    expect(lineChart().selectedIndex()).toBeNull();
  });

  it('associa i valori del riquadro alle chiavi delle serie mantenendo ordine e segni', async () => {
    await render();
    await select(1);

    expect(tooltipLines()).toEqual([
      'Entrate: +1725,00 €',
      'Uscite: −340,00 €',
      'Netto: +1385,00 €',
    ]);

    // Una serie spenta in legenda esce anche dal riquadro.
    await toggleLegend('Netto');
    expect(tooltipLines()).toEqual(['Entrate: +1725,00 €', 'Uscite: −340,00 €']);
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
    const tooltipTitle = (): string =>
      host().querySelector('app-chart-tooltip h2')?.textContent?.trim() ?? '';

    await render(weekly(), 'week');
    expect(xLabels()).toEqual(['29/06', '06/07', '13/07', '20/07']);
    await select(1);
    expect(tooltipTitle()).toContain('settimana del 6 luglio');

    await render(
      { granularity: 'day', buckets: [bucket('2026-07-06', 10, 5), bucket('2026-07-07', 0, 9)] },
      'day',
    );
    expect(xLabels()).toEqual(['06/07', '07/07']);
    await select(1);
    expect(tooltipTitle()).toContain('07/07/2026');

    await render(
      { granularity: 'month', buckets: [bucket('2026-06', 1000, 500), bucket('2026-07', 0, 900)] },
      'month',
    );
    expect(xLabels()).toEqual(['giu 26', 'lug 26']);
    await select(1);
    expect(tooltipTitle()).toContain('luglio 2026');
  });

  it('aggiorna le etichette quando cambia la granularità sulla stessa istanza', async () => {
    await render(weekly(), 'week');
    const before = lineChart().xLabel();

    fixture.componentRef.setInput('timeline', {
      granularity: 'month',
      buckets: [bucket('2026-06', 1000, 500), bucket('2026-07', 0, 900)],
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

    expect(drawnKeys()).toEqual(['income', 'expenses', 'net']);
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

  it('il pulsante del riquadro dice che filtra l’analisi su quel periodo', async () => {
    await render();
    await select(1);

    // Non apre più una vista a parte: cambia il periodo dei filtri.
    expect(host().querySelector('.tooltip-action')?.textContent?.trim()).toBe(
      'Filtra su questo periodo',
    );
    expect(tooltip()?.textContent).not.toContain('Apri movimenti');
  });

  it('chiede di filtrare sul periodo completo della settimana selezionata', async () => {
    await render();
    const requested: TimelineSelection[] = [];
    fixture.componentInstance.periodSelected.subscribe((selection) => requested.push(selection));
    await select(1);

    host().querySelector<HTMLButtonElement>('.tooltip-action')?.click();

    expect(requested).toEqual([
      {
        granularity: 'week',
        period: '2026-07-06',
        range: { from: '2026-07-06', to: '2026-07-12' },
        label: 'settimana del 6 luglio',
      },
    ]);
  });

  it('chiede di filtrare dal primo all’ultimo giorno del mese selezionato', async () => {
    await render(
      {
        granularity: 'month',
        buckets: [bucket('2026-02', 300, 100)],
      },
      'month',
    );
    const requested: TimelineSelection[] = [];
    fixture.componentInstance.periodSelected.subscribe((selection) => requested.push(selection));
    await select(0);

    host().querySelector<HTMLButtonElement>('.tooltip-action')?.click();

    expect(requested).toEqual([
      {
        granularity: 'month',
        period: '2026-02',
        range: { from: '2026-02-01', to: '2026-02-28' },
        label: 'febbraio 2026',
      },
    ]);
  });

  // La pagina cambia subito il passo ma tiene i bucket vecchi finché arrivano
  // i nuovi: un `YYYY-MM` letto come giorno era una data non valida (e un
  // RangeError di Intl). I bucket si leggono col passo dei dati.
  it('legge i bucket col passo dei dati, anche se il passo scelto è già un altro', async () => {
    await render(
      { granularity: 'month', buckets: [bucket('2026-06', 1000, 500), bucket('2026-07', 0, 900)] },
      'day',
    );

    expect(xLabels()).toEqual(['giu 26', 'lug 26']);

    await select(0);
    expect(host().querySelector('app-chart-tooltip h2')?.textContent).toContain('giugno 2026');

    const requested: TimelineSelection[] = [];
    fixture.componentInstance.periodSelected.subscribe((selection) => requested.push(selection));
    await select(1);
    expect(host().querySelector('app-chart-tooltip h2')?.textContent).toContain('luglio 2026');

    host().querySelector<HTMLButtonElement>('.tooltip-action')?.click();

    expect(requested).toEqual([
      {
        granularity: 'month',
        period: '2026-07',
        range: { from: '2026-07-01', to: '2026-07-31' },
        label: 'luglio 2026',
      },
    ]);
  });

  describe('vista cumulata', () => {
    // weekly(): variazioni −120,50, +1385,00, −880,07, −546,00.
    const CUMULATIVE = [-120.5, 1264.5, 384.43, -161.57];

    it('di partenza la vista è «Flussi», col titolo «Flusso nel tempo»', async () => {
      await render();

      expect(viewButton('Flussi')?.getAttribute('aria-pressed')).toBe('true');
      expect(viewButton('Cumulato')?.getAttribute('aria-pressed')).toBe('false');
      expect(host().querySelector('[aria-label="Vista dell\'andamento"]')).not.toBeNull();
      expect(chartTitle()).toContain('Flusso nel tempo');
      expect(chartTitle()).not.toContain('Andamento cumulato');
      expect(lineChart().zeroLine()).toBe(false);
    });

    it('«Cumulato» disegna una sola serie, il saldo netto sommato dall’inizio del periodo', async () => {
      await render();
      await chooseView('Cumulato');

      const series = lineChart().series();
      expect(series.map((item) => item.label)).toEqual(['Saldo periodo']);
      expect(series.map((item) => item.color)).toEqual(['chart-3']);
      expect(
        lineChart()
          .points()
          .map((point) => series[0]!.value(point)),
      ).toEqual(CUMULATIVE);
      // Sopra o sotto lo zero è la prima cosa che il cumulato racconta.
      expect(lineChart().zeroLine()).toBe(true);
    });

    it('nasconde la legenda, che con una serie sola non distingue nulla', async () => {
      await render();
      await chooseView('Cumulato');

      expect(host().querySelector('.legend')).toBeNull();
    });

    it('cambia il titolo in «Andamento cumulato», e torna com’era ai flussi', async () => {
      await render();
      await chooseView('Cumulato');

      expect(chartTitle()).toContain('Andamento cumulato');
      expect(chartTitle()).not.toContain('Flusso nel tempo');

      await chooseView('Flussi');
      expect(chartTitle()).toContain('Flusso nel tempo');
    });

    it('si torna ai flussi con le serie di prima', async () => {
      await render();
      await chooseView('Cumulato');
      await chooseView('Flussi');

      expect(drawnKeys()).toEqual(['income', 'expenses', 'net']);
      expect(host().querySelector('.legend')).not.toBeNull();
    });

    it('anima il grafico quando si cambia vista', async () => {
      await render();

      expect(host().querySelector('.plot')?.classList.contains('chart-transitioning')).toBe(false);

      await chooseView('Cumulato');
      expect(host().querySelector('.plot')?.classList.contains('chart-transitioning')).toBe(true);

      await chooseView('Flussi');
      expect(host().querySelector('.plot')?.classList.contains('chart-transitioning')).toBe(true);
    });

    it('anima il grafico quando si cambia granularità', async () => {
      await render();

      const selectedGranularities: TimelineGranularity[] = [];
      fixture.componentInstance.granularitySelected.subscribe((granularity) =>
        selectedGranularities.push(granularity),
      );

      await chooseGranularity('Mese');

      expect(host().querySelector('.plot')?.classList.contains('chart-transitioning')).toBe(true);
      expect(selectedGranularities).toEqual(['month']);
      expect(lineChart().zeroLine()).toBe(false);
    });

    it('i punti vuoti degli intervalli incompleti restano', async () => {
      await render();
      await chooseView('Cumulato');

      const marker = lineChart().marker();
      expect(
        lineChart()
          .points()
          .map((point) => marker(point)),
      ).toEqual(['hollow', 'auto', 'auto', 'hollow']);
    });

    it('il riquadro mostra il cumulato e la variazione dell’intervallo', async () => {
      await render();
      await chooseView('Cumulato');
      await select(1);

      const shown = (tooltip()?.textContent ?? '').replace(/\./g, '').replace(/\s+/g, ' ');
      expect(shown).toContain('settimana del 6 luglio');
      expect(shown).toContain('+1264,50');
      expect(shown).toContain('Saldo periodo');
      expect(shown).toContain('+1385,00 € in questa settimana');
      expect(shown).not.toContain('Entrate');
    });

    it('mantiene selezionato lo stesso periodo passando tra flussi e cumulato', async () => {
      await render();
      await select(1);

      await chooseView('Cumulato');
      expect(lineChart().selectedIndex()).toBe(1);
      expect(host().querySelector('app-chart-tooltip h2')?.textContent).toContain(
        'settimana del 6 luglio',
      );
      expect(tooltip()?.textContent).toContain('+1264,50');

      await chooseView('Flussi');
      expect(lineChart().selectedIndex()).toBe(1);
      expect(host().querySelector('app-chart-tooltip h2')?.textContent).toContain(
        'settimana del 6 luglio',
      );
      expect(tooltip()?.textContent).toContain('+1725,00');
    });

    it('la variazione dice il proprio segno e l’unità del passo dei dati', async () => {
      await render(
        {
          granularity: 'month',
          buckets: [bucket('2026-06', 1000, 500), bucket('2026-07', 0, 900)],
        },
        'month',
      );
      await chooseView('Cumulato');
      await select(1);

      const shown = (tooltip()?.textContent ?? '').replace(/\./g, '').replace(/\s+/g, ' ');
      expect(shown).toContain('−400,00');
      expect(shown).toContain('−900,00 € in questo mese');
    });

    it('«Filtra su questo periodo» resta e chiede lo stesso periodo', async () => {
      await render();
      await chooseView('Cumulato');
      const requested: TimelineSelection[] = [];
      fixture.componentInstance.periodSelected.subscribe((selection) => requested.push(selection));
      await select(1);

      host().querySelector<HTMLButtonElement>('.tooltip-action')?.click();

      expect(requested).toEqual([
        {
          granularity: 'week',
          period: '2026-07-06',
          range: { from: '2026-07-06', to: '2026-07-12' },
          label: 'settimana del 6 luglio',
        },
      ]);
    });

    it('il riquadro di un intervallo incompleto ha cumulato, variazione e la nota', async () => {
      await render();
      await chooseView('Cumulato');
      await select(3);

      const shown = (tooltip()?.textContent ?? '').replace(/\./g, '').replace(/\s+/g, ' ');
      expect(tooltipLines()).toEqual(['Saldo periodo: −161,57 €']);
      expect(shown).toContain('−546,00 € in questa settimana');
      expect(shown).toContain('Intervallo incompleto');
    });

    it('la vista resta nel componente: nessun cambio di passo né di periodo', async () => {
      await render();
      const emitted: unknown[] = [];
      fixture.componentInstance.granularitySelected.subscribe((step) => emitted.push(step));
      fixture.componentInstance.periodSelected.subscribe((selection) => emitted.push(selection));

      await chooseView('Cumulato');

      expect(emitted).toEqual([]);
    });
  });
});
