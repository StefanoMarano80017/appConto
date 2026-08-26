import { Component, computed, input, output, signal } from '@angular/core';
import { formatAmount } from '../../core/format';
import { MerchantDistribution } from './analytics.model';

/** Quanti merchant mostrare prima di chiedere conferma: la coda è quasi sempre lunga. */
const INITIAL_LIMIT = 10;

/** Distribuzione delle spese per merchant: "da chi sto spendendo di più?". */
@Component({
  selector: 'app-analytics-merchants',
  templateUrl: './analytics-merchants.html',
  styleUrl: './analytics-merchants.scss'
})
export class AnalyticsMerchants {
  readonly merchants = input.required<MerchantDistribution[]>();

  /** Richiesta di restringere l'analisi ad un merchant. */
  readonly merchantSelected = output<string>();

  protected readonly expanded = signal(false);

  protected readonly visible = computed(() =>
    this.expanded() ? this.merchants() : this.merchants().slice(0, INITIAL_LIMIT)
  );

  protected readonly hidden = computed(() =>
    Math.max(this.merchants().length - INITIAL_LIMIT, 0)
  );

  protected readonly formatAmount = formatAmount;
}
