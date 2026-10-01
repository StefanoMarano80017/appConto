import { Component, computed, effect, inject, signal } from '@angular/core';
import { formatMonth } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { Panel } from '../../shared/layout/panel';
import { PageLayout } from '../../shared/layout/page-layout';
import { SectionHeader } from '../../shared/layout/section-header';
import { FilterChips } from '../../shared/ui/filter-chips';
import { StatCardDelta, StatCardGrid, StatCardItem } from '../../shared/layout/stat-card-grid';
import { CashFlowCard } from '../cash-flow/cash-flow-card';
import {
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABELS,
  TransactionType
} from '../transactions/transaction-type';
import { TRANSACTION_TYPE_OPTIONS } from '../transactions/transaction-type-options';
import { TransactionsTable } from '../../shared/ui/transactions-table';
import { CategoryBreakdownSection } from './category-breakdown';
import { DashboardFilterStore } from './dashboard-filter.store';
import { Dashboard, MonthComparison } from './dashboard.model';
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

  /**
   * I tipi con etichetta e icona, per la tabella in sola lettura.
   *
   * Qui i movimenti sono un riepilogo: si correggono nella pagina dei
   * movimenti, non dalla dashboard, quindi la tabella non salva nulla e non
   * c'è niente da ricaricare dopo.
   */
  protected readonly transactionTypeOptions = TRANSACTION_TYPE_OPTIONS;

  protected readonly transactionTypes = TRANSACTION_TYPES;
  protected readonly typeLabels = TRANSACTION_TYPE_LABELS;
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

    const { income, expenses, balance, transactionCount, merchantCount } = data.summary;

    return [
      // `income` è una magnitudine positiva (v. summary.view-model.ts): nessuna
      // negazione, nessun tono. `Amount` ne deduce il verde da sola.
      { kind: 'amount', label: 'Entrate', value: income, icon: 'entrate' },
      // `expenses` è una magnitudine positiva ma rappresenta un'uscita: la
      // neghiamo qui senza forzare il tono, così un totale dominato da rimborsi
      // (hasExpense è vera prima di guardare il segno) torna verde da solo
      // invece di restare rosso a forza. Il confronto mensile esiste solo per
      // le uscite (v. `expensesDelta`): è l'unica card con un chip.
      {
        kind: 'amount',
        label: 'Uscite',
        value: -expenses,
        icon: 'uscite',
        delta: this.expensesDelta(data.comparison)
      },
      // `balance` è già `income - expenses`, con il segno giusto: nessun tono
      // imposto, nemmeno per lo zero — `Amount` lo tratta già da neutro.
      { kind: 'amount', label: 'Saldo', value: balance, icon: 'saldo' },
      { kind: 'text', label: 'Transazioni', value: String(transactionCount), icon: 'conteggio' },
      // Nessuna icona mappata per i merchant: le quattro ammesse coprono le
      // altre card, e inventarne una quinta senza un caso reale nel mockup
      // andrebbe contro la ragione stessa dell'unione chiusa.
      { kind: 'text', label: 'Merchant', value: String(merchantCount) }
    ];
  });

  /**
   * Il chip «vs mese precedente» della card «Uscite».
   *
   * `undefined` quando `percentChange` è `null`: il backend non calcola un
   * confronto (il mese precedente non ha spese), e mostrare uno `0%` al
   * posto di "non calcolabile" sarebbe un dato falso, non assente.
   *
   * Il tono non segue il segno di `percentChange`: per le uscite crescere
   * (`percentChange > 0`) è una cattiva notizia, quindi tono `negative`, il
   * contrario di quanto varrebbe per un'entrata. È la card che dichiara il
   * tono, non `StatCardGrid` che lo deduce.
   */
  private expensesDelta(comparison: MonthComparison): StatCardDelta | undefined {
    const { percentChange, previousMonth } = comparison;
    if (percentChange === null) {
      return undefined;
    }

    return {
      percent: percentChange,
      caption: `vs ${this.formatMonth(previousMonth)}`,
      tone: percentChange > 0 ? 'negative' : percentChange < 0 ? 'positive' : 'neutral'
    };
  }

  constructor() {
    effect((onCleanup) => {
      const filters = this.filters.filters();

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
}
