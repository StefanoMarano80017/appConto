import { Component, computed, effect, inject, signal } from '@angular/core';
import { formatAmount, formatMonth } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { CashFlowCard } from '../cash-flow/cash-flow-card';
import {
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABELS,
  TransactionType
} from '../transactions/transaction-type';
import { TransactionsTable } from '../transactions/transactions-table';
import { CategoryBreakdownSection } from './category-breakdown';
import { DashboardFilterStore } from './dashboard-filter.store';
import { Dashboard } from './dashboard.model';
import { DashboardApi } from './dashboard.api';
import { MonthComparisonSection } from './month-comparison';
import { TopMerchantsSection } from './top-merchants';

/**
 * Home dell'applicazione.
 *
 * È l'unico componente che carica i dati: tutte le sezioni ricevono in input
 * porzioni della stessa risposta, quindi non possono mostrare periodi o filtri
 * diversi fra loro.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [
    CashFlowCard,
    CategoryBreakdownSection,
    MonthComparisonSection,
    TopMerchantsSection,
    TransactionsTable
  ],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss'
})
export class DashboardPage {
  private readonly    api = inject(DashboardApi);
  protected readonly  filters = inject(DashboardFilterStore);

  protected readonly dashboard = signal<Dashboard | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Cresce ad ogni modifica fatta dalla tabella, per forzare un ricaricamento. */
  private readonly reloadToken = signal(0);

  protected readonly transactionTypes = TRANSACTION_TYPES;
  protected readonly typeLabels = TRANSACTION_TYPE_LABELS;
  protected readonly formatAmount = formatAmount;
  protected readonly formatMonth = formatMonth;

  /** Etichette dei filtri attivi, risolte sui dati appena caricati. */
  protected readonly activeFilters = computed(() => {
    const data = this.dashboard();
    if (data === null) {
      return [];
    }

    const chips: { kind: 'type' | 'category' | 'merchant'; label: string }[] = [];
    const { type, categoryId, merchantId } = this.filters.filters();

    if (type !== null) {
      chips.push({ kind: 'type', label: TRANSACTION_TYPE_LABELS[type] });
    }
    if (categoryId !== null) {
      const category = data.categories.find((c) => c.id === categoryId);
      chips.push({ kind: 'category', label: category?.name ?? 'Categoria' });
    }
    if (merchantId !== null) {
      const merchant = data.transactions.find((t) => t.merchant?.id === merchantId)?.merchant;
      chips.push({ kind: 'merchant', label: merchant?.label ?? 'Merchant' });
    }

    return chips;
  });

  constructor() {
    effect((onCleanup) => {
      const filters = this.filters.filters();
      this.reloadToken();

      this.loading.set(true);
      this.error.set(null);

      const subscription = this.api.get(filters).subscribe({
        next: (dashboard) => {
          this.dashboard.set(dashboard);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(toErrorMessage(error));
          this.loading.set(false);
        }
      });

      onCleanup(() => subscription.unsubscribe());
    });
  }

  protected onMonthChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value !== '') {
      this.filters.setMonth(value);
    }
  }

  protected onTypeChange(value: string): void {
    this.filters.setType(value === '' ? null : (value as TransactionType));
  }

  protected removeFilter(kind: 'type' | 'category' | 'merchant'): void {
    if (kind === 'type') {
      this.filters.setType(null);
    } else if (kind === 'category') {
      this.filters.setCategory(null);
    } else {
      this.filters.setMerchant(null);
    }
  }

  protected reload(): void {
    this.reloadToken.update((token) => token + 1);
  }
}
