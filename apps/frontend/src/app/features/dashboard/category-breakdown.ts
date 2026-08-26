import { Component, computed, input, output } from '@angular/core';
import { formatAmount, formatBookingDate } from '../../core/format';
import { CategoryBreakdown } from './dashboard.model';

/** Larghezza minima della barra, perché anche un importo piccolo resti visibile. */
const MIN_BAR_WIDTH = 2;

@Component({
  selector: 'app-category-breakdown',
  templateUrl: './category-breakdown.html',
  styleUrl: './category-breakdown.scss'
})
export class CategoryBreakdownSection {
  readonly categories = input.required<CategoryBreakdown[]>();

  /** Richiesta di filtrare la dashboard su una categoria o su un merchant. */
  readonly categorySelected = output<string | null>();
  readonly merchantSelected = output<string>();

  protected readonly formatAmount = formatAmount;
  protected readonly formatBookingDate = formatBookingDate;

  private readonly maxAmount = computed(() =>
    Math.max(0, ...this.categories().map((category) => category.amount))
  );

  protected barWidth(amount: number): number {
    const max = this.maxAmount();

    return max <= 0 ? 0 : Math.max(MIN_BAR_WIDTH, (amount / max) * 100);
  }
}
