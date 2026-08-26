import { httpResource } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Params, Router, RouterLink } from '@angular/router';
import { formatAmount } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { CategoriesApi } from '../categories/categories.api';
import { Category } from '../categories/category.model';
import { MerchantSummary } from '../merchants/merchant.model';
import { MerchantsApi } from '../merchants/merchants.api';
import {
  EMPTY_QUERY,
  TransactionQueryState,
  toQueryParams
} from '../transactions/transaction-query';
import { Analytics } from './analytics.model';
import { analyticsRequest } from './analytics.api';
import { AnalyticsCategories } from './analytics-categories';
import { AnalyticsLoans } from './analytics-loans';
import { AnalyticsMerchants } from './analytics-merchants';
import { AnalyticsTimeline } from './analytics-timeline';
import { AnalyticsToolbar } from './analytics-toolbar';
import { AnalyticsStore } from './analytics.store';

/** Una card della fascia superiore. */
interface Kpi {
  label: string;
  value: string;
  tone: 'positive' | 'negative' | 'neutral';
}

/**
 * Pagina Analytics.
 *
 * È l'unico componente che carica l'analisi: ogni sezione riceve in input una
 * porzione della stessa risposta, quindi rappresentano tutte lo stesso dataset
 * filtrato. La richiesta è derivata dai criteri: `httpResource` la rifà da sé
 * quando cambiano e annulla quella precedente.
 */
@Component({
  selector: 'app-analytics-page',
  imports: [
    AnalyticsCategories,
    AnalyticsLoans,
    AnalyticsMerchants,
    AnalyticsTimeline,
    AnalyticsToolbar,
    RouterLink
  ],
  templateUrl: './analytics-page.html',
  styleUrl: './analytics-page.scss'
})
export class AnalyticsPage implements OnInit {
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly merchantsApi = inject(MerchantsApi);
  private readonly router = inject(Router);
  protected readonly store = inject(AnalyticsStore);

  protected readonly analytics = httpResource<Analytics>(() =>
    analyticsRequest(this.store.query())
  );

  /** Servono ai filtri per mostrare nomi al posto di identificativi. */
  protected readonly categories = signal<Category[]>([]);
  protected readonly merchants = signal<MerchantSummary[]>([]);

  /**
   * L'analisi caricata, oppure `undefined`.
   *
   * `value()` solleverebbe l'errore quando la richiesta è fallita: qui la
   * risposta e l'errore restano due stati distinti, entrambi mostrabili.
   */
  protected readonly data = computed<Analytics | undefined>(() =>
    this.analytics.hasValue() ? this.analytics.value() : undefined
  );

  protected readonly error = computed(() => {
    const error = this.analytics.error();

    return error === undefined ? null : toErrorMessage(error);
  });

  protected readonly isEmpty = computed(() => this.data()?.counts.transactions === 0);

  /**
   * Le card della fascia superiore.
   *
   * Prelievi, prestiti, trasferimenti e movimenti "altro" compaiono solo se il
   * dataset ne contiene: una card a zero occuperebbe spazio senza dire nulla.
   */
  protected readonly kpis = computed<Kpi[]>(() => {
    const data = this.data();
    if (data === undefined) {
      return [];
    }

    const { overview, counts } = data;
    const secondary: [string, number][] = [
      ['Prelievi', overview.withdrawals],
      ['Prestiti', overview.loans],
      ['Trasferimenti', overview.transfers],
      ['Altro', overview.other]
    ];

    return [
      { label: 'Entrate', value: formatAmount(overview.income), tone: 'positive' },
      { label: 'Uscite', value: formatAmount(overview.expenses), tone: 'negative' },
      {
        label: 'Saldo netto',
        value: formatAmount(overview.balance),
        tone: overview.balance < 0 ? 'negative' : 'positive'
      },
      { label: 'Transazioni', value: String(counts.transactions), tone: 'neutral' },
      ...secondary
        .filter(([, value]) => value !== 0)
        .map(([label, value]): Kpi => ({ label, value: formatAmount(value), tone: 'neutral' }))
    ];
  });

  ngOnInit(): void {
    this.categoriesApi.list().subscribe({ next: (categories) => this.categories.set(categories) });
    this.merchantsApi.summary().subscribe({ next: (merchants) => this.merchants.set(merchants) });
  }

  /**
   * I criteri con cui aprire l'esplorazione dei movimenti.
   *
   * Portano sempre con sé il periodo e i filtri già attivi qui, più ciò su cui
   * si è cliccato. Il contesto passa esclusivamente dalla query string: nessuno
   * stato nascosto fra le due pagine.
   */
  protected explorerParams(extra: Partial<TransactionQueryState> = {}): Params {
    const { from, to } = this.store.dateRange();
    const { types, categoryIds, merchantIds, classification } = this.store.filters();

    return toQueryParams({
      ...EMPTY_QUERY,
      from,
      to,
      types,
      categoryIds,
      merchantIds,
      classification,
      ...extra
    });
  }

  private openExplorer(extra: Partial<TransactionQueryState>): void {
    void this.router.navigate(['/transactions'], { queryParams: this.explorerParams(extra) });
  }

  /** Il drill down su una categoria: senza categoria significa "da classificare". */
  protected onCategorySelected(categoryId: string | null): void {
    this.openExplorer(
      categoryId === null
        ? { classification: 'unclassified', types: ['EXPENSE'] }
        : { categoryIds: [categoryId], types: ['EXPENSE'] }
    );
  }

  protected onMerchantSelected(merchantId: string): void {
    this.openExplorer({ merchantIds: [merchantId] });
  }
}
