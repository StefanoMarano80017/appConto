import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsTimeline } from './analytics-timeline';
import { Timeline, TimelineBucket, TimelineGranularity } from './analytics.model';

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

  const render = async (
    timeline: Timeline = weekly(),
    granularity: TimelineGranularity = 'week'
  ): Promise<void> => {
    fixture = TestBed.createComponent(AnalyticsTimeline);
    fixture.componentRef.setInput('timeline', timeline);
    fixture.componentRef.setInput('granularity', granularity);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AnalyticsTimeline] }).compileComponents();
  });

  it('disegna una spezzata per entrata e una per uscita', async () => {
    await render();

    const lines = host().querySelectorAll('polyline.line');

    expect(lines.length).toBe(2);
    expect([...lines].map((line) => line.getAttribute('data-series'))).toEqual([
      'income',
      'expenses'
    ]);
    // Quattro punti per spezzata: "x,y" separati da spazi.
    expect(lines[0]?.getAttribute('points')?.trim().split(/\s+/).length).toBe(4);
  });

  it('il saldo netto non è acceso di partenza, ma si può accendere', async () => {
    await render();
    expect(host().querySelectorAll('polyline.line').length).toBe(2);

    const netto = [...host().querySelectorAll<HTMLButtonElement>('.legend button')].find(
      (button) => button.textContent?.includes('Saldo netto')
    );
    netto?.click();
    await fixture.whenStable();

    expect(host().querySelectorAll('polyline.line').length).toBe(3);
    expect(host().querySelector('polyline.line[data-series="net"]')).not.toBeNull();
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

    for (const label of ['Entrate', 'Uscite']) {
      [...host().querySelectorAll<HTMLButtonElement>('.legend button')]
        .find((button) => button.textContent?.includes(label))
        ?.click();
      await fixture.whenStable();
    }

    expect(host().querySelectorAll('polyline.line').length).toBe(1);
  });

  it('segna gli intervalli incompleti con un punto vuoto', async () => {
    await render();

    const partial = host().querySelectorAll('circle.point.partial');

    // Due intervalli parziali per ciascuna delle due serie visibili.
    expect(partial.length).toBe(4);
    expect(text()).toContain('intervalli coperti solo in parte');
  });

  /**
   * Il puntatore a metà dell'intervallo indicato, in pixel dello strato di mira.
   *
   * `plotLeft`/`plotWidth` non ridichiarano `pad`/`plot` del componente (che
   * da quando `pad.left` è calcolato dalla larghezza delle etichette non sono
   * nemmeno più costanti): li legge dal primo `<line class="grid">` già
   * renderizzato, gli stessi `x1`/`x2` che il template lega a `pad().left` e
   * `pad().left + plot().width`. Un valore ridichiarato qui è quello che è
   * andato fuori sincrono nel round precedente.
   */
  const pointAt = (index: number, total: number): number => {
    const grid = host().querySelector('line.grid');
    const plotLeft = Number(grid?.getAttribute('x1'));
    const plotRight = Number(grid?.getAttribute('x2'));
    const band = (plotRight - plotLeft) / (total - 1);

    return ((plotLeft + index * band) / 760) * 760;
  };

  const hover = async (index: number, total = 4): Promise<void> => {
    const layer = host().querySelector<HTMLElement>('.hit');
    Object.defineProperty(layer, 'clientWidth', { value: 760, configurable: true });
    const event = new MouseEvent('pointermove', { bubbles: true });
    Object.defineProperty(event, 'offsetX', { value: pointAt(index, total) });
    layer?.dispatchEvent(event);
    await fixture.whenStable();
  };

  it('il passaggio su un intervallo mostra tutti i valori di quel punto', async () => {
    await render();
    await hover(1);

    const shown = (host().querySelector('.tooltip')?.textContent ?? '').replace(/\./g, '');

    expect(shown).toContain('settimana del 6 luglio');
    // Il segno, non solo la cifra: un'entrata e un'uscita non si distinguono
    // dal solo colore, e prima d'ora questa asserzione sarebbe passata anche
    // invertendo i due toni.
    expect(shown).toContain('+1725,00');
    expect(shown).toContain('−340,00');
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

    await hover(1, 2);
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
    await hover(0);

    expect(host().querySelector('.tooltip')?.textContent).toContain('Intervallo incompleto');
  });

  it('uscendo dal grafico il riquadro si chiude', async () => {
    await render();
    await hover(1);
    expect(host().querySelector('.tooltip')).not.toBeNull();

    host().querySelector<HTMLElement>('.hit')?.dispatchEvent(new Event('pointerleave'));
    await fixture.whenStable();

    expect(host().querySelector('.tooltip')).toBeNull();
  });

  it('da tastiera si scorre con le freccie, con un solo punto di tabulazione', async () => {
    await render();

    const layer = host().querySelector<HTMLElement>('.hit');
    expect(host().querySelectorAll('[tabindex="0"]').length).toBe(1);
    expect(layer?.getAttribute('aria-label')).toContain('freccie');

    layer?.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(host().querySelector('.tooltip')?.textContent).toContain('29 giugno');

    layer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await fixture.whenStable();
    expect(host().querySelector('.tooltip')?.textContent).toContain('6 luglio');

    layer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    await fixture.whenStable();
    expect(host().querySelector('.tooltip')?.textContent).toContain('20 luglio');

    // Oltre l'ultimo intervallo non si va.
    layer?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await fixture.whenStable();
    expect(host().querySelector('.tooltip')?.textContent).toContain('20 luglio');
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

    [...host().querySelectorAll<HTMLButtonElement>('app-segmented-control button')]
      .find((button) => button.textContent?.includes('Mese'))
      ?.click();

    expect(emitted).toEqual(['month']);
  });

  it('etichetta gli intervalli secondo il passo', async () => {
    await render(weekly(), 'week');
    expect(text()).toContain('settimana');

    await render(
      { granularity: 'month', buckets: [bucket('2026-06', 1000, 500), bucket('2026-07', 0, 900)] },
      'month'
    );
    expect(text()).toContain('mese');
    expect(host().querySelector('.hit')).not.toBeNull();
  });

  it('un periodo senza movimenti lo dice, invece di disegnare il vuoto', async () => {
    await render({ granularity: 'week', buckets: [] });

    expect(text()).toContain('Nessun movimento nel periodo selezionato');
    expect(host().querySelector('polyline.line')).toBeNull();
    expect(host().querySelector('.legend')).toBeNull();
  });

  it('un solo intervallo resta leggibile', async () => {
    await render({ granularity: 'week', buckets: [bucket('2026-07-06', 100, 50)] });

    expect(host().querySelectorAll('circle.point').length).toBe(2);
    expect(host().querySelector('.hit')).not.toBeNull();
  });
});
