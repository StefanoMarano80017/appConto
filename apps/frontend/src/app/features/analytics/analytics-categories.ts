import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideChartPie, LucideList } from '@lucide/angular';
import { formatPercent } from '../../core/format';
import { Panel } from '../../shared/layout/panel';
import { SectionHeader } from '../../shared/layout/section-header';
import { Amount } from '../../shared/ui/amount';
import { DoughnutCenter, DoughnutChart, groupedSliceLabel } from '../../shared/ui/chart/doughnut-chart';
import type { DoughnutSlice, SliceColor } from '../../shared/ui/chart/doughnut-chart.model';
import { ChoiceGroup, ChoiceOption } from '../../shared/ui/choice-group';
import { CategoryDistribution } from './analytics.model';

type CategoriesView = 'chart' | 'list';

/** Ciò che il foro della ciambella mostra: una fetta attiva, oppure il totale. */
interface CenterSummary {
  readonly label: string;
  readonly amount: number;
  readonly percentage: number | null;
}

/**
 * Distribuzione delle spese per categoria.
 *
 * Le spese non ancora classificate compaiono come tutte le altre: nasconderle
 * farebbe sembrare il totale più piccolo di quello che è.
 *
 * Due viste sugli stessi dati: la ciambella dà a colpo d'occhio le proporzioni,
 * la lista dà tutte le categorie con conteggio e importo. La ciambella
 * raggruppa le voci minori in «Altri», che non è una categoria e quindi non ha
 * un filtro a cui portare: il clic su quella fetta apre la Lista, dove le
 * categorie raggruppate si vedono una per una e ciascuna è selezionabile.
 */
@Component({
  selector: 'app-analytics-categories',
  imports: [Panel, SectionHeader, Amount, ChoiceGroup, DoughnutChart, DoughnutCenter],
  templateUrl: './analytics-categories.html',
  styleUrl: './analytics-categories.scss',
})
export class AnalyticsCategories {
  readonly categories = input.required<CategoryDistribution[]>();
  /** Le categorie già nei filtri: si vedono premute nella Lista e risaltano nella ciambella. */
  readonly activeCategoryIds = input<readonly string[]>([]);
  /** Il filtro «da classificare» è attivo: vale per la voce senza categoria. */
  readonly unclassifiedActive = input(false);

  /** Richiesta di restringere l'analisi ad una categoria; `null` = senza categoria. */
  readonly categorySelected = output<string | null>();

  protected readonly formatPercent = formatPercent;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly view = signal<CategoriesView>('chart');
  protected readonly views: readonly ChoiceOption<CategoriesView>[] = [
    {
      id: 'chart',
      label: 'Grafico',
      icon: LucideChartPie.icon,
    },
    {
      id: 'list',
      label: 'Lista',
      icon: LucideList.icon,
    },
  ];

  // Campi e non metodi: il grafico li riceve come input, e un riferimento nuovo
  // a ogni rendering gli farebbe ricalcolare le fette per niente.
  protected readonly sliceValue = (category: CategoryDistribution): number => category.amount;
  protected readonly sliceLabel = (category: CategoryDistribution): string => category.name;
  protected readonly sliceColor = (category: CategoryDistribution): SliceColor =>
    category.color ? { custom: category.color } : 'chart-neutral';

  // Calcolato e non metodo, per la stessa ragione: cambia solo coi filtri.
  protected readonly isActive = computed(() => {
    const ids = this.activeCategoryIds();
    const unclassified = this.unclassifiedActive();
    return (category: CategoryDistribution): boolean =>
      category.categoryId === null ? unclassified : ids.includes(category.categoryId);
  });

  private readonly maxAmountCategory = computed(() =>
    this.categories().reduce((max, category) => Math.max(max, category.amount), 0),
  );

  /** Il grafico disegna solo importi positivi: un rimborso netto non è una fetta. */
  protected readonly chartTotal = computed(() =>
    this.categories().reduce((sum, category) => sum + Math.max(category.amount, 0), 0),
  );

  /** La barra è proporzionale alla categoria più consistente, non al totale. */
  protected barWidth(amount: number): number {
    const widest = this.maxAmountCategory();

    return widest === 0 ? 0 : (amount / widest) * 100;
  }

  /**
   * Il template del centro non conosce il tipo delle voci (Angular non lo
   * ricava dal contenuto proiettato): il calcolo sta qui, tipizzato, e il
   * template rende soltanto il risultato.
   */
  protected center(slice: DoughnutSlice<CategoryDistribution> | null): CenterSummary {
    if (slice === null) {
      return (
        this.filteredSummary() ?? {
          label: 'Totale spese',
          amount: this.chartTotal(),
          percentage: null,
        }
      );
    }

    if (slice.kind === 'item') {
      return {
        label: slice.item.name,
        amount: slice.item.amount,
        percentage: slice.item.percentage,
      };
    }

    return {
      label: groupedSliceLabel(slice.items.length),
      amount: slice.items.reduce((sum, category) => sum + category.amount, 0),
      percentage: slice.items.reduce((sum, category) => sum + category.percentage, 0),
    };
  }

  /**
   * Con un filtro attivo il totale di tutte le categorie sarebbe fuorviante: il
   * foro somma solo quelle filtrate (come il grafico, i rimborsi netti non contano).
   * `null` senza filtri.
   */
  private readonly filteredSummary = computed<CenterSummary | null>(() => {
    const isActive = this.isActive();
    const filtered = this.categories().filter(isActive);
    if (filtered.length === 0) {
      return null;
    }

    return {
      label: filtered.length === 1 ? filtered[0].name : `${filtered.length} categorie filtrate`,
      amount: filtered.reduce((sum, category) => sum + Math.max(category.amount, 0), 0),
      percentage: null,
    };
  });

  protected onSliceActivated(slice: DoughnutSlice<CategoryDistribution>): void {
    if (slice.kind === 'item') {
      this.categorySelected.emit(slice.item.categoryId);
    } else {
      this.view.set('list');
      this.focusGroupedRow(slice.items[0]);
    }
  }

  /**
   * Passare alla Lista distrugge il canvas che aveva il focus, che da tastiera
   * finirebbe su <body>. Lo si porta sulla prima categoria raggruppata, cioè
   * dove chi ha scelto «Altri» voleva arrivare; se la riga non si trova, sul
   * toggle, che resta comunque nella scheda. Solo a Lista resa: prima non esiste.
   */
  private focusGroupedRow(first: CategoryDistribution | undefined): void {
    afterNextRender(
      () => {
        const target = first ? this.rowForCategory(first) : this.activeViewToggle();
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  private rowForCategory(category: CategoryDistribution): HTMLElement | null {
    const index = this.categories().indexOf(category);
    return this.host.nativeElement.querySelectorAll<HTMLElement>('ul .row')[index] ?? null;
  }

  private activeViewToggle(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(
      'app-choice-group button[aria-pressed="true"]',
    );
  }
}
