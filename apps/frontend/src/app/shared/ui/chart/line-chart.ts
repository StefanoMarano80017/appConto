import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  model,
  signal
} from '@angular/core';
import { ThemeStore } from '../../../core/theme';
import { AppChart, type ChartDataPoint } from './chart';
import { lineChartData, lineChartOptions, lineChartValueRange } from './line-chart-config';
import { resolveLineChartTheme, type LineChartTheme } from './line-chart-theme';
import type { LineChartValueAxis, LinePointMarker, LineSeries } from './line-chart.model';
import { LINE_CHART_PLUGINS } from './line-guides-plugin';

// Le feature non importano `chart.ts`: il token passa da qui, il punto
// d'ingresso pubblico, così le loro spec possono sostituire Chart.js.
export { CHART_CONSTRUCTOR } from './chart';

/**
 * Grafico a linee condiviso.
 *
 * Qui sta tutto ciò che è uguale per ogni grafico a linee dell'app: tema
 * risolto dai token, geometria, guide verticali, e l'interazione (puntatore,
 * click, tastiera, focus) espressa come un solo indice di punto. Le feature
 * non vedono né Chart.js né gli indici dei dataset.
 *
 * Resta alla feature ciò che ha un significato di dominio: che cosa vuol dire
 * selezionare un punto (`selectedIndex`), il contenuto del tooltip (proiettato
 * dentro l'host), la legenda e quali serie mostrare.
 */
@Component({
  selector: 'app-line-chart',
  imports: [AppChart],
  templateUrl: './line-chart.html',
  styleUrl: './line-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Chart.js non notifica l'uscita dal canvas: senza questo l'ultimo punto
    // resterebbe attivo. Sta sull'host e non sul canvas perché il tooltip
    // proiettato è dentro l'host: passarci sopra non è uscire dal grafico.
    '(pointerleave)': 'hover.set(null)'
  }
})
export class LineChart<T> {
  readonly points = input.required<readonly T[]>();
  readonly series = input.required<readonly LineSeries<T>[]>();
  readonly xLabel = input.required<(point: T) => string>();
  readonly marker = input<(point: T) => LinePointMarker>(() => 'auto');
  readonly valueAxis = input<LineChartValueAxis>('amount');
  readonly ariaLabel = input.required<string>();
  /** Una linea marcata sullo zero, per le serie in cui «sopra o sotto» è la lettura principale. */
  readonly zeroLine = input(false);
  readonly selectedIndex = model<number | null>(null);

  protected readonly plugins = LINE_CHART_PLUGINS;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly themeStore = inject(ThemeStore);

  private readonly theme = signal<LineChartTheme | null>(null);
  protected readonly hover = signal<number | null>(null);

  /** Il puntatore vince sulla selezione: si evidenzia ciò che si sta guardando. */
  private readonly activeIndex = computed(() => this.hover() ?? this.selectedIndex());

  protected readonly activeElements = computed<readonly ChartDataPoint[]>(() => {
    const index = this.activeIndex();
    return index === null
      ? []
      : this.series().map((_series, datasetIndex) => ({ datasetIndex, index }));
  });

  // Separati di proposito: l'hover cambia solo le opzioni, così i dati restano
  // lo stesso oggetto e AppChart non li riassegna a ogni movimento del puntatore.
  protected readonly data = computed(() => {
    const theme = this.theme();
    return theme === null
      ? null
      : lineChartData(this.points(), this.series(), this.marker(), this.xLabel(), theme);
  });

  // Non legge l'hover: a ogni movimento del puntatore non si rifanno valori e scala.
  private readonly valueRange = computed(() => {
    const points = this.points();
    const values = this.series().flatMap((series) => points.map((point) => series.value(point)));
    return lineChartValueRange(this.valueAxis(), values);
  });

  protected readonly options = computed(() => {
    const theme = this.theme();
    if (theme === null) {
      return null;
    }

    return lineChartOptions(
      theme,
      this.valueAxis(),
      this.valueRange(),
      { selected: this.selectedIndex(), hover: this.hover() },
      this.zeroLine()
    );
  });

  constructor() {
    // Il canvas non sa leggere var(): i colori vanno risolti in valori. E
    // ThemeStore applica `data-theme` in un proprio effect, quindi lo stile
    // calcolato è affidabile solo a render avvenuto. La sola dipendenza è il
    // tema dello store; `this.theme` qui si scrive e non si legge, perciò
    // l'aggiornamento non può rilanciare l'effect.
    afterRenderEffect({
      read: () => {
        this.themeStore.theme();
        this.theme.set(resolveLineChartTheme(getComputedStyle(this.host.nativeElement)));
      }
    });
  }

  protected onHover(elements: readonly ChartDataPoint[]): void {
    this.hover.set(elements[0]?.index ?? null);
  }

  /** Un secondo click sullo stesso punto lo deseleziona. */
  protected onClick(elements: readonly ChartDataPoint[]): void {
    const index = elements[0]?.index;
    this.selectedIndex.set(index === undefined || this.selectedIndex() === index ? null : index);
  }

  /** Da tastiera si scorre con le frecce: un solo punto di tabulazione, non uno per punto. */
  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.selectedIndex.set(null);
      return;
    }

    const last = this.points().length - 1;
    const current = this.hover() ?? 0;
    const next = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: last
    }[event.key];

    // Senza punti non c'è dove andare: l'indice risulterebbe -1.
    if (next === undefined || last < 0) {
      return;
    }

    event.preventDefault();
    const index = Math.min(Math.max(next, 0), last);
    this.hover.set(index);
    this.selectedIndex.set(index);
  }

  /** Chi arriva col tab vede subito un punto, senza perdere quello già scelto. */
  protected onFocus(): void {
    this.selectedIndex.set(this.selectedIndex() ?? 0);
  }

  protected onBlur(): void {
    this.hover.set(null);
  }
}
