import { Component, computed, effect, inject, signal } from '@angular/core';
import { formatAmount, formatMonth } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { Panel } from '../../shared/layout/panel';
import { PageLayout } from '../../shared/layout/page-layout';
import { SectionHeader } from '../../shared/layout/section-header';
import { FilterChips } from '../../shared/ui/filter-chips';
import { StatCardGrid, StatCardItem } from '../../shared/layout/stat-card-grid';
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
    FilterChips,
    MonthComparisonSection,
    Panel,
    PageLayout,
    SectionHeader,
    StatCardGrid,
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

    const chips: { key: 'type' | 'category' | 'merchant'; label: string }[] = [];
    const { type, categoryId, merchantId } = this.filters.filters();

    if (type !== null) {
      chips.push({ key: 'type', label: TRANSACTION_TYPE_LABELS[type] });
    }
    if (categoryId !== null) {
      const category = data.categories.find((c) => c.id === categoryId);
      chips.push({ key: 'category', label: category?.name ?? 'Categoria' });
    }
    if (merchantId !== null) {
      const merchant = data.transactions.find((t) => t.merchant?.id === merchantId)?.merchant;
      chips.push({ key: 'merchant', label: merchant?.label ?? 'Merchant' });
    }

    return chips;
  });

  protected readonly summaryCards = computed<StatCardItem[]>(() => {
    const data = this.dashboard();
    if (data === null) {
      return [];
    }

    const { balance } = data.summary;

    return [
      { label: 'Entrate', value: formatAmount(data.summary.income), tone: 'positive' },
      { label: 'Uscite', value: formatAmount(data.summary.expenses), tone: 'negative' },
      {
        label: 'Saldo',
        value: formatAmount(balance),
        tone: balance > 0 ? 'positive' : balance < 0 ? 'negative' : 'neutral'
      },
      { label: 'Transazioni', value: String(data.summary.transactionCount), tone: 'neutral' },
      { label: 'Merchant', value: String(data.summary.merchantCount), tone: 'neutral' }
    ];
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

  protected removeFilter(key: 'type' | 'category' | 'merchant'): void {
    if (key === 'type') {
      this.filters.setType(null);
    } else if (key === 'category') {
      this.filters.setCategory(null);
    } else {
      this.filters.setMerchant(null);
    }
  }

  protected reload(): void {
    this.reloadToken.update((token) => token + 1);
  }
}
