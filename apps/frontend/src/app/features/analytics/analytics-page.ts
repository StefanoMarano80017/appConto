import { httpResource } from '@angular/common/http';
import { Component, OnInit, computed, effect, inject, linkedSignal, signal } from '@angular/core';
import { Params, Router, RouterLink } from '@angular/router';
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
import { Panel } from '../../shared/layout/panel';
import { PageLayout } from '../../shared/layout/page-layout';
import { StatCardGrid, StatCardItem } from '../../shared/layout/stat-card-grid';
import { Analytics } from './analytics.model';
import { analyticsRequest } from './analytics.api';
import { AnalyticsCategories } from './analytics-categories';
import { AnalyticsLoans } from './analytics-loans';
import { AnalyticsMerchants } from './analytics-merchants';
import { AnalyticsSelection, isSelectionAvailable, selectionCriteria } from './analytics-selection';
import { AnalyticsTimeline, TimelineSelection } from './analytics-timeline';
import { AnalyticsTransactions } from './analytics-transactions';
import { AnalyticsFilters } from './analytics-filters';
import { AnalyticsStore } from './analytics.store';

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
    AnalyticsFilters,
    AnalyticsLoans,
    AnalyticsMerchants,
    AnalyticsTimeline,
    AnalyticsTransactions,
    PageLayout,
    Panel,
    RouterLink,
    StatCardGrid
  ],
  templateUrl: './analytics-page.html',
  styleUrl: './analytics-page.scss'
})
export class AnalyticsPage implements OnInit {
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly merchantsApi = inject(MerchantsApi);
  private readonly router = inject(Router);
  protected readonly store = inject(AnalyticsStore);
  protected readonly selection = inject(AnalyticsSelection);

  protected readonly analytics = httpResource<Analytics>(() =>
    analyticsRequest(this.store.query())
  );

  /** Servono ai filtri per mostrare nomi al posto di identificativi. */
  protected readonly categories = signal<Category[]>([]);
  protected readonly merchants = signal<MerchantSummary[]>([]);

  /**
   * L'ultima analisi caricata, che resta a schermo mentre ne arriva un'altra.
   *
   * `httpResource` azzera il valore quando la richiesta cambia: senza questa
   * latch, cambiare un filtro farebbe sparire il grafico e ricomparire — cioè
   * esattamente il movimento che questa pagina esiste per togliere.
   *
   * `value()` solleverebbe l'errore quando la richiesta è fallita: qui la
   * risposta e l'errore restano due stati distinti, entrambi mostrabili.
   */
  protected readonly data = linkedSignal<Analytics | undefined, Analytics | undefined>({
    source: () => (this.analytics.hasValue() ? this.analytics.value() : undefined),
    computation: (caricata, precedente) => caricata ?? precedente?.value
  });

  protected readonly error = computed(() => {
    const error = this.analytics.error();

    return error === undefined ? null : toErrorMessage(error);
  });

  /**
   * I dati a schermo non sono quelli dei filtri correnti: o ne stanno
   * arrivando altri, o la richiesta è fallita e questi sono i precedenti.
   */
  protected readonly isStale = computed(() => this.analytics.isLoading() || this.error() !== null);

  protected readonly isEmpty = computed(() => this.data()?.counts.transactions === 0);

  /**
   * Le card della fascia superiore.
   *
   * Prelievi, prestiti, trasferimenti e movimenti "altro" compaiono solo se il
   * dataset ne contiene: una card a zero occuperebbe spazio senza dire nulla.
   */
  protected readonly kpis = computed<StatCardItem[]>(() => {
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
      // `income` è una magnitudine positiva (v. analytics.view-model.ts): nessuna
      // negazione, nessun tono. `Amount` la legge com'è e ne deduce il verde.
      { kind: 'amount', label: 'Entrate', value: overview.income },
      // `expenses` è una magnitudine positiva quanto `income`, ma rappresenta
      // un'uscita: la neghiamo qui, senza forzare il tono. Un rimborso conta
      // come spesa prima di guardare il segno (`hasExpense`), quindi il totale
      // non è garantito positivo: se un periodo è dominato da rimborsi, la
      // negazione lo riporta da sola in verde invece di restare rosso a forza.
      { kind: 'amount', label: 'Uscite', value: -overview.expenses },
      // `balance` è già `income - expenses`, con il segno giusto: si passa così,
      // senza tono imposto.
      { kind: 'amount', label: 'Saldo netto', value: overview.balance },
      { kind: 'text', label: 'Transazioni', value: String(counts.transactions) },
      ...secondary
        .filter(([, value]) => value !== 0)
        // Prelievi/prestiti/trasferimenti/altro conservano già il segno (sono
        // "somme con segno", non magnitudini). Prelievi e trasferimenti non
        // muovono il patrimonio (`netWorthCents` li azzera), «Prestiti» è
        // credito, non spesa: nessuno dei tre è un'entrata o un'uscita.
        // «Altro» è diverso: `netWorthCents` lo somma come un'entrata o
        // un'uscita qualunque (nessun caso speciale in transaction-type.ts,
        // ricade nel ramo che restituisce `amountCents`), quindi il
        // patrimonio lo sente. Il tono neutro qui non dice "non conta": dice
        // che è il tipo residuale per ciò che non rientra in nessun'altra
        // categoria del dominio, quindi non c'è una base per giudicarlo
        // buono o cattivo — non dedotto, dichiarato.
        .map(([label, value]): StatCardItem => ({ kind: 'amount', label, value, tone: 'neutral' }))
    ];
  });

  /**
   * I criteri del pannello: quelli dell'analisi, con sopra quelli dell'elemento
   * selezionato, se ce n'è uno; senza, il periodo intero con i suoi filtri.
   * Pagina, dimensione e ordinamento restano i predefiniti di `EMPTY_QUERY`:
   * la prima pagina, per data decrescente.
   */
  protected readonly panelQuery = computed<TransactionQueryState>(() => {
    const selection = this.selection.selection();
    const { from, to } = this.store.dateRange();
    const { types, categoryIds, merchantIds, classification } = this.store.filters();

    return {
      ...EMPTY_QUERY,
      from,
      to,
      types,
      categoryIds,
      merchantIds,
      classification,
      ...(selection === null ? {} : selectionCriteria(selection))
    };
  });

  constructor() {
    /*
     * Un cambio di filtri, periodo o passo può togliere dai dati l'elemento
     * selezionato: allora la selezione cade e il pannello torna al periodo
     * intero. Si guarda solo ai dati arrivati: durante un caricamento quelli a
     * schermo sono i precedenti, e rientrando nella pagina non ce ne sono ancora. La selezione resta finché
     * una risposta non dice che l'elemento non c'è più.
     */
    effect(() => {
      const data = this.data();
      const selection = this.selection.selection();
      if (data === undefined || selection === null) {
        return;
      }

      if (this.isEmpty() || !isSelectionAvailable(selection, data)) {
        this.selection.clear();
      }
    });
  }

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

  protected onTimelineTransactionsRequested(selection: TimelineSelection): void {
    this.selection.select({ kind: 'period', ...selection });
  }

  /** Senza categoria significa "da classificare": il titolo lo dice da sé. */
  protected onCategorySelected(categoryId: string | null): void {
    const entry = this.data()?.byCategory.find((category) => category.categoryId === categoryId);

    this.selection.select({ kind: 'category', categoryId, name: entry?.name ?? '' });
  }

  /** Un merchant non restringe la tabella: porta ai suoi movimenti, con periodo e filtri. */
  protected onMerchantSelected(merchantId: string): void {
    void this.router.navigate(['/transactions'], {
      queryParams: this.explorerParams({ merchantIds: [merchantId] })
    });
  }

  /**
   * «Mostra tutto»: la tabella torna al periodo intero, e il pannello resta
   * dov'è. Il pulsante sparisce col click, ma di proposito il focus non viene
   * spostato da programma: la pagina non muove più né scroll né focus da sé
   * (revisione del 2026-10-01 della specifica).
   */
  protected onSelectionCleared(): void {
    this.selection.clear();
  }
}
