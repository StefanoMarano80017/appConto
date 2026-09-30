import { NgTemplateOutlet } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  Directive,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  TemplateRef
} from '@angular/core';
import type { Plugin } from 'chart.js';
import { ThemeStore } from '../../../core/theme';
import { AppChart, type ChartDataPoint } from './chart';
import { doughnutChartData, doughnutChartOptions } from './doughnut-chart-config';
import { resolveDoughnutChartTheme, type DoughnutChartTheme } from './doughnut-chart-theme';
import type { DoughnutSlice, SliceColor } from './doughnut-chart.model';
import { groupTopN } from './doughnut-grouping';

// Le feature non importano `chart.ts`: il token passa da qui, il punto
// d'ingresso pubblico, così le loro spec possono sostituire Chart.js.
export { CHART_CONSTRUCTOR } from './chart';

/** Contesto del centro: la fetta attiva, oppure `null` se non ce n'è una. */
export interface DoughnutCenterContext<T> {
  readonly $implicit: DoughnutSlice<T> | null;
}

/**
 * Segna il template che la feature vuole nel foro della ciambella. È un
 * template e non contenuto proiettato perché va reso di nuovo a ogni cambio
 * di fetta attiva, con la fetta come contesto.
 */
@Directive({ selector: 'ng-template[appDoughnutCenter]' })
export class DoughnutCenter<T> {
  readonly template = inject<TemplateRef<DoughnutCenterContext<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(
    _directive: DoughnutCenter<T>,
    context: unknown
  ): context is DoughnutCenterContext<T> {
    return true;
  }
}

// Riferimento stabile: un nuovo array a ogni lettura farebbe ricreare il grafico ad AppChart.
const DOUGHNUT_CHART_PLUGINS: readonly Plugin<'doughnut'>[] = [];

/**
 * Grafico a ciambella condiviso.
 *
 * Qui sta tutto ciò che è uguale per ogni ciambella dell'app: raggruppamento
 * delle voci minori in «Altri», tema risolto dai token, geometria, e
 * l'interazione (puntatore, click, tastiera, focus) espressa come una sola
 * fetta attiva. Le feature non vedono né Chart.js né gli indici dei dataset:
 * ricevono fette (`DoughnutSlice`), cioè le proprie voci.
 *
 * Resta alla feature ciò che ha un significato di dominio: che cosa vuol dire
 * attivare una fetta (`sliceActivated`) e che cosa mostrare nel foro
 * (il template `appDoughnutCenter`).
 */
@Component({
  selector: 'app-doughnut-chart',
  imports: [AppChart, NgTemplateOutlet],
  templateUrl: './doughnut-chart.html',
  styleUrl: './doughnut-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Chart.js non notifica l'uscita dal canvas: senza questo l'ultima fetta
    // resterebbe attiva. Sta sull'host perché il centro sovrapposto è dentro
    // l'host: passarci sopra non è uscire dal grafico.
    '(pointerleave)': 'hover.set(null)'
  }
})
export class DoughnutChart<T> {
  readonly items = input.required<readonly T[]>();
  readonly value = input.required<(item: T) => number>();
  readonly label = input.required<(item: T) => string>();
  readonly color = input.required<(item: T) => SliceColor>();
  readonly topN = input(5);
  readonly othersLabel = input('Altri');
  readonly ariaLabel = input.required<string>();

  readonly sliceActivated = output<DoughnutSlice<T>>();

  protected readonly center = contentChild<DoughnutCenter<T>>(DoughnutCenter);

  protected readonly plugins = DOUGHNUT_CHART_PLUGINS;
  // Non dipende da nulla: un solo oggetto, così AppChart non riassegna le opzioni.
  protected readonly options = doughnutChartOptions();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly themeStore = inject(ThemeStore);

  private readonly theme = signal<DoughnutChartTheme | null>(null);
  protected readonly hover = signal<number | null>(null);
  private readonly focusIndex = signal<number | null>(null);

  protected readonly slices = computed(() => groupTopN(this.items(), this.value(), this.topN()));

  /**
   * Il puntatore vince sulla tastiera: si mostra ciò che si sta guardando.
   * Un indice oltre le fette (voci appena ridotte) non vale nulla.
   */
  private readonly activeIndex = computed(() => {
    const index = this.hover() ?? this.focusIndex();
    return index !== null && index < this.slices().length ? index : null;
  });

  protected readonly activeSlice = computed(() => {
    const index = this.activeIndex();
    return index === null ? null : this.slices()[index];
  });

  protected readonly activeElements = computed<readonly ChartDataPoint[]>(() => {
    const index = this.activeIndex();
    return index === null ? [] : [{ datasetIndex: 0, index }];
  });

  // Non legge hover né focus: i dati restano lo stesso oggetto e AppChart non
  // li riassegna a ogni movimento del puntatore.
  protected readonly data = computed(() => {
    const theme = this.theme();
    return theme === null
      ? null
      : doughnutChartData(this.slices(), this.label(), this.color(), this.othersLabel(), theme);
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
        this.theme.set(resolveDoughnutChartTheme(getComputedStyle(this.host.nativeElement)));
      }
    });

    // Filtrare in `activeIndex` non basta: un indice rimasto in sospeso
    // tornerebbe valido quando le voci ricrescono, riattivando una fetta che
    // nessuno ha scelto. Uscito dalle fette, si scarta davvero.
    effect(() => {
      const count = this.slices().length;
      const focus = this.focusIndex();
      if (focus !== null && focus >= count) {
        this.focusIndex.set(null);
      }
      const hover = this.hover();
      if (hover !== null && hover >= count) {
        this.hover.set(null);
      }
    });
  }

  protected onHover(elements: readonly ChartDataPoint[]): void {
    this.hover.set(elements[0]?.index ?? null);
  }

  /** Solo una fetta sotto il puntatore si attiva: il click nel foro o fuori non dice nulla. */
  protected onClick(elements: readonly ChartDataPoint[]): void {
    const index = elements[0]?.index;
    const slice = index === undefined ? undefined : this.slices()[index];
    if (slice !== undefined) {
      this.sliceActivated.emit(slice);
    }
  }

  /**
   * Da tastiera si scorre con le frecce, in cerchio perché la ciambella non ha
   * un inizio visivo: un solo punto di tabulazione, non uno per fetta.
   */
  protected onKeyDown(event: KeyboardEvent): void {
    const count = this.slices().length;
    // Senza fette non c'è dove andare né cosa attivare.
    if (count === 0) {
      return;
    }

    if (event.key === 'Escape') {
      this.focusIndex.set(null);
      this.hover.set(null);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      const slice = this.activeSlice();
      if (slice !== null) {
        // Lo spazio altrimenti scorrerebbe la pagina.
        event.preventDefault();
        this.sliceActivated.emit(slice);
      }
      return;
    }

    const current = this.activeIndex();
    const previous = current === null ? count - 1 : (current - 1 + count) % count;
    const following = current === null ? 0 : (current + 1) % count;
    const next = {
      ArrowLeft: previous,
      ArrowUp: previous,
      ArrowRight: following,
      ArrowDown: following,
      Home: 0,
      End: count - 1
    }[event.key];

    if (next === undefined) {
      return;
    }

    event.preventDefault();
    // Si toglie l'hover: il puntatore vincerebbe e la scelta da tastiera non si vedrebbe.
    this.hover.set(null);
    this.focusIndex.set(next);
  }

  /** Chi arriva col tab vede subito una fetta, senza perdere quella già scelta. */
  protected onFocus(): void {
    if (this.slices().length > 0) {
      this.focusIndex.set(this.focusIndex() ?? 0);
    }
  }

  protected onBlur(): void {
    this.hover.set(null);
    this.focusIndex.set(null);
  }
}
