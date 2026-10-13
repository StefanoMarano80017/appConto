import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  InjectionToken,
  input,
  OnDestroy,
  output,
  ViewChild
} from '@angular/core';
import {
  ArcElement,
  Chart as ChartJS,
  CategoryScale,
  DoughnutController,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  type ActiveElement,
  type ChartEvent,
  type ChartData,
  type ChartOptions,
  type Plugin
} from 'chart.js';

ChartJS.register(
  ArcElement,
  CategoryScale,
  DoughnutController,
  LinearScale,
  LineController,
  LineElement,
  PointElement
);

/**
 * Costruttore Chart.js usato da `AppChart`. I test lo sostituiscono con un
 * finto tramite i provider di TestBed: il builder di Angular esegue le spec
 * senza isolamento e con chunk condivisi, quindi `vi.mock('chart.js')` in
 * una spec non garantisce che questo modulo veda proprio quel mock.
 */
export const CHART_CONSTRUCTOR = new InjectionToken<typeof ChartJS>('CHART_CONSTRUCTOR', {
  providedIn: 'root',
  factory: () => ChartJS
});

/** I tipi di grafico che l'app disegna: solo di questi sono registrati i componenti. */
export type AppChartType = 'line' | 'doughnut';

export type ChartOptionsWithoutInteractionCallbacks<TType extends AppChartType = 'line'> = Omit<
  ChartOptions<TType>,
  'onHover' | 'onClick'
>;

export interface ChartDataPoint {
  readonly datasetIndex: number;
  readonly index: number;
}

@Component({
  selector: 'app-chart',
  templateUrl: './chart.html',
  styleUrl: './chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppChart<TType extends AppChartType> implements AfterViewInit, OnDestroy {
  readonly type = input.required<TType>();
  readonly data = input.required<ChartData<TType, number[], string>>();
  // Le opzioni di Chart.js sono tutte facoltative, ma con `TType` ancora aperto
  // TypeScript non riesce a dimostrare che `{}` le soddisfi per ogni tipo.
  readonly options = input<ChartOptionsWithoutInteractionCallbacks<TType>>(
    {} as ChartOptionsWithoutInteractionCallbacks<TType>
  );
  readonly plugins = input<readonly Plugin<TType>[]>([]);
  readonly activeElements = input<readonly ChartDataPoint[]>([]);
  readonly ariaLabel = input.required<string>();
  readonly role = input('img');
  readonly tabIndex = input(-1);

  readonly hovered = output<readonly ChartDataPoint[]>();
  readonly clicked = output<readonly ChartDataPoint[]>();
  readonly keyDown = output<KeyboardEvent>();
  readonly focused = output<FocusEvent>();
  readonly blurred = output<FocusEvent>();

  @ViewChild('canvas') private canvas?: ElementRef<HTMLCanvasElement>;

  private readonly chartConstructor = inject(CHART_CONSTRUCTOR);
  private chart?: ChartJS<TType, number[], string>;
  private configuredType?: TType;
  private configuredPlugins?: readonly Plugin<TType>[];
  private appliedData?: ChartData<TType, number[], string>;
  private appliedOptions?: ChartOptionsWithoutInteractionCallbacks<TType>;

  constructor() {
    effect(() => {
      const type = this.type();
      const data = this.data();
      const options = this.options();
      const plugins = this.plugins();
      const activeElements = this.activeElements();
      this.updateChart(type, data, options, plugins, activeElements);
    });
  }

  ngAfterViewInit(): void {
    this.createChart();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private createChart(): void {
    const canvas = this.canvas?.nativeElement;
    if (!canvas || !canvas.getContext('2d')) {
      return;
    }

    const type = this.type();
    const plugins = this.plugins();
    this.chart = new this.chartConstructor(canvas, {
      type,
      data: this.data(),
      options: this.optionsWithEvents(),
      plugins: [...plugins]
    });
    this.configuredType = type;
    this.configuredPlugins = plugins;
    this.appliedData = this.data();
    this.appliedOptions = this.options();
    this.applyActiveElements(this.activeElements());
  }

  private updateChart(
    type: TType,
    data: ChartData<TType, number[], string>,
    options: ChartOptionsWithoutInteractionCallbacks<TType>,
    plugins: readonly Plugin<TType>[],
    activeElements: readonly ChartDataPoint[]
  ): void {
    if (!this.chart) {
      return;
    }

    if (type !== this.configuredType || plugins !== this.configuredPlugins) {
      this.chart.destroy();
      this.chart = undefined;
      this.createChart();
      return;
    }

    // Cambia solo l'hover (dati e opzioni sono gli stessi oggetti già applicati):
    // basta spostare gli elementi attivi, senza riassegnare i dati né ricreare le
    // opzioni con nuove closure. Anche la lista vuota (hover finito) va applicata.
    if (data === this.appliedData && options === this.appliedOptions) {
      this.chart.setActiveElements(this.validActiveElements(activeElements));
      this.chart.update('none');
      return;
    }

    // Gli elementi attivi puntano agli elementi disegnati: vanno tolti prima di
    // cambiare i dati, altrimenti `update()` riapplica l'hover a elementi che
    // non esistono più, solleva un errore e non arriva mai a ridisegnare.
    this.chart.setActiveElements([]);
    this.chart.data = data;
    this.chart.options = this.optionsWithEvents(options);
    this.chart.update('none');
    this.appliedData = data;
    this.appliedOptions = options;
    this.applyActiveElements(activeElements);
  }

  /** Va chiamato a grafico aggiornato: gli indici fuori dai dati correnti si scartano. */
  private validActiveElements(activeElements: readonly ChartDataPoint[]): ChartDataPoint[] {
    const datasets = this.chart?.data.datasets ?? [];
    return activeElements.filter(
      ({ datasetIndex, index }) =>
        index >= 0 && index < (datasets[datasetIndex]?.data.length ?? 0)
    );
  }

  private applyActiveElements(activeElements: readonly ChartDataPoint[]): void {
    const valid = this.validActiveElements(activeElements);
    if (!this.chart || valid.length === 0) {
      return;
    }

    this.chart.setActiveElements(valid);
    this.chart.update('none');
  }

  private optionsWithEvents(options = this.options()): ChartOptions<TType> {
    // Rimettere le due callback tolte da `Omit` restituisce proprio
    // `ChartOptions<TType>`, ma con `TType` aperto TypeScript non ricompone
    // `Omit<X, K> & Pick<X, K>` in `X`: da qui il cast.
    return {
      ...options,
      onHover: (_event: ChartEvent, activeElements: ActiveElement[]) => {
        this.hovered.emit(
          activeElements.map(({ datasetIndex, index }) => ({ datasetIndex, index }))
        );
      },
      onClick: (_event: ChartEvent, activeElements: ActiveElement[]) => {
        this.clicked.emit(
          activeElements.map(({ datasetIndex, index }) => ({ datasetIndex, index }))
        );
      }
    } as ChartOptions<TType>;
  }
}
