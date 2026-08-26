import { Component, computed, input, output } from '@angular/core';
import { formatAmount, formatPercent } from '../../core/format';
import { CategoryDistribution } from './analytics.model';

/**
 * Distribuzione delle spese per categoria.
 *
 * Le spese non ancora classificate compaiono come tutte le altre: nasconderle
 * farebbe sembrare il totale più piccolo di quello che è.
 */
@Component({
  selector: 'app-analytics-categories',
  templateUrl: './analytics-categories.html',
  styleUrl: './analytics-categories.scss'
})
export class AnalyticsCategories {
  readonly categories = input.required<CategoryDistribution[]>();

  /** Richiesta di restringere l'analisi ad una categoria; `null` = senza categoria. */
  readonly categorySelected = output<string | null>();

  protected readonly formatAmount = formatAmount;
  protected readonly formatPercent = formatPercent;

  private readonly widest = computed(() =>
    this.categories().reduce((max, category) => Math.max(max, category.amount), 0)
  );

  /** La barra è proporzionale alla categoria più consistente, non al totale. */
  protected barWidth(amount: number): number {
    const widest = this.widest();

    return widest === 0 ? 0 : (amount / widest) * 100;
  }
}
