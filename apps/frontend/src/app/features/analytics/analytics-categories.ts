import { Component, computed, input, output, signal } from '@angular/core';
import { formatPercent } from '../../core/format';
import { Panel } from '../../shared/layout/panel';
import { SectionHeader } from '../../shared/layout/section-header';
import { Amount } from '../../shared/ui/amount';
import { DoughnutCenter, DoughnutChart } from '../../shared/ui/chart/doughnut-chart';
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
  styleUrl: './analytics-categories.scss'
})
export class AnalyticsCategories {
  readonly categories = input.required<CategoryDistribution[]>();

  /** Richiesta di restringere l'analisi ad una categoria; `null` = senza categoria. */
  readonly categorySelected = output<string | null>();

  protected readonly formatPercent = formatPercent;

  protected readonly view = signal<CategoriesView>('chart');
  protected readonly views: readonly ChoiceOption<CategoriesView>[] = [
    { id: 'chart', label: 'Grafico' },
    { id: 'list', label: 'Lista' }
  ];

  // Campi e non metodi: il grafico li riceve come input, e un riferimento nuovo
  // a ogni rendering gli farebbe ricalcolare le fette per niente.
  protected readonly value = (category: CategoryDistribution): number => category.amount;
  protected readonly label = (category: CategoryDistribution): string => category.name;
  protected readonly color = (category: CategoryDistribution): SliceColor =>
    category.color ? { custom: category.color } : 'chart-neutral';

  private readonly widest = computed(() =>
    this.categories().reduce((max, category) => Math.max(max, category.amount), 0)
  );

  /** Il grafico disegna solo importi positivi: un rimborso netto non è una fetta. */
  protected readonly drawnTotal = computed(() =>
    this.categories().reduce((sum, category) => sum + Math.max(category.amount, 0), 0)
  );

  /** La barra è proporzionale alla categoria più consistente, non al totale. */
  protected barWidth(amount: number): number {
    const widest = this.widest();

    return widest === 0 ? 0 : (amount / widest) * 100;
  }

  /**
   * Il template del centro non conosce il tipo delle voci (Angular non lo
   * ricava dal contenuto proiettato): il calcolo sta qui, tipizzato, e il
   * template rende soltanto il risultato.
   */
  protected center(slice: DoughnutSlice<CategoryDistribution> | null): CenterSummary {
    if (slice === null) {
      return { label: 'Totale spese', amount: this.drawnTotal(), percentage: null };
    }

    if (slice.kind === 'item') {
      return {
        label: slice.item.name,
        amount: slice.item.amount,
        percentage: slice.item.percentage
      };
    }

    return {
      label: 'Altri',
      amount: slice.items.reduce((sum, category) => sum + category.amount, 0),
      percentage: slice.items.reduce((sum, category) => sum + category.percentage, 0)
    };
  }

  protected onSliceActivated(slice: DoughnutSlice<CategoryDistribution>): void {
    if (slice.kind === 'item') {
      this.categorySelected.emit(slice.item.categoryId);
    } else {
      this.view.set('list');
    }
  }
}
