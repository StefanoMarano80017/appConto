import { Component, computed, input, output, signal } from '@angular/core';
import { Panel } from '../../shared/layout/panel';
import { SectionHeader } from '../../shared/layout/section-header';
import { Amount } from '../../shared/ui/amount';
import { MerchantDistribution } from './analytics.model';

/** Quanti merchant mostrare prima di chiedere conferma: la coda è quasi sempre lunga. */
const INITIAL_LIMIT = 10;

/** Distribuzione delle spese per merchant: "da chi sto spendendo di più?". */
@Component({
  selector: 'app-analytics-merchants',
  imports: [Panel, SectionHeader, Amount],
  templateUrl: './analytics-merchants.html',
  styleUrl: './analytics-merchants.scss'
})
export class AnalyticsMerchants {
  readonly merchants = input.required<MerchantDistribution[]>();
  /** I merchant già nei filtri: le loro righe si vedono premute. */
  readonly activeMerchantIds = input<readonly string[]>([]);

  /** Richiesta di restringere l'analisi ad un merchant. */
  readonly merchantSelected = output<string>();

  protected readonly expanded = signal(false);

  protected readonly visible = computed(() =>
    this.expanded() ? this.merchants() : this.merchants().slice(0, INITIAL_LIMIT)
  );

  protected readonly hidden = computed(() =>
    Math.max(this.merchants().length - INITIAL_LIMIT, 0)
  );
}
