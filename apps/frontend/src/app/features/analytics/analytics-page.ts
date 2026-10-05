import { httpResource } from '@angular/common/http';
import { Component, OnInit, Signal, computed, inject, linkedSignal, signal } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
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
import { AnalyticsTimeline, TimelineSelection } from './analytics-timeline';
import { AnalyticsTransactions } from './analytics-transactions';
import { AnalyticsFilters } from './analytics-filters';
import { comfortableGranularity } from './period-granularity';
import { AnalyticsQueryState, AnalyticsStore } from './analytics.store';
import { CrossFilterDimension, crossFilterQuery, needsCrossFilter } from './cross-filter';

/** I dati di una ripartizione e se quelli a schermo sono da aggiornare. */
interface CrossFilteredSection {
  readonly data: Signal<Analytics | undefined>;
  readonly stale: Signal<boolean>;
}

/**
 * La risposta da cui legge una ripartizione col cross-filter: quella di una
 * richiesta senza il filtro della sua dimensione (v. cross-filter.ts).
 *
 * La richiesta in più parte solo quando serve: senza filtri della dimensione
 * la funzione di `httpResource` restituisce `undefined`, la risorsa resta
 * ferma e la sezione legge la risposta principale, che in quel caso coincide.
 *
 * Stessa latch dei dati principali: mentre arriva la risposta nuova resta a
 * schermo la precedente, attenuata. Al primo filtro, senza ancora una risposta
 * propria, resta quella principale — che fino a un attimo prima era proprio
 * senza quel filtro.
 *
 * Se la richiesta in più fallisce, la sezione torna alla risposta principale,
 * attenuata: mostra solo ciò che è filtrato, ma un confronto mancato non vale
 * una sezione vuota o un errore di pagina. L'errore di pagina resta quello
 * della richiesta principale.
 *
 * Va chiamata in un contesto di iniezione: crea una `httpResource`.
 */
function crossFilteredSection(
  dimension: CrossFilterDimension,
  query: () => AnalyticsQueryState,
  main: () => Analytics | undefined,
  mainStale: () => boolean
): CrossFilteredSection {
  const needed = computed(() => needsCrossFilter(query(), dimension));
  const resource = httpResource<Analytics>(() =>
    needed() ? analyticsRequest(crossFilterQuery(query(), dimension)) : undefined
  );
  const latched = linkedSignal<Analytics | undefined, Analytics | undefined>({
    source: () => (resource.hasValue() ? resource.value() : undefined),
    computation: (caricata, precedente) => caricata ?? precedente?.value
  });
  const failed = computed(() => resource.error() !== undefined);

  return {
    data: computed(() => (needed() && !failed() ? (latched() ?? main()) : main())),
    stale: computed(() => (needed() ? resource.isLoading() || failed() : mainStale()))
  };
}

/**
 * Pagina Analytics.
 *
 * È l'unico componente che carica l'analisi: ogni sezione riceve in input una
 * porzione della risposta dei filtri correnti. Fanno eccezione le ripartizioni
 * per categoria e per merchant, col cross-filter: ciascuna ignora il filtro
 * della propria dimensione e rispetta tutti gli altri, così la categoria o il
 * merchant filtrato si vede fra gli altri invece di restare solo. KPI,
 * andamento, prestiti e tabella seguono la query completa. Le richieste sono
 * derivate dai criteri: `httpResource` le rifà da sé quando cambiano e
 * annulla quelle precedenti.
 *
 * L'unica fonte è `AnalyticsStore`: grafici e tabella dipendono solo dai suoi
 * filtri, e i filtri cambiano solo per un gesto — nella barra o con un click
 * su un grafico. Nessuno stato di vista a parte, nessun effetto che li tocchi
 * da sé.
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
  protected readonly store = inject(AnalyticsStore);

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

  /** Categorie col cross-filter: la richiesta lascia fuori categorie e classificazione. */
  protected readonly categorySection = crossFilteredSection(
    'category',
    this.store.query,
    this.data,
    this.isStale
  );

  /** Merchant col cross-filter: la richiesta lascia fuori i merchant. */
  protected readonly merchantSection = crossFilteredSection(
    'merchant',
    this.store.query,
    this.data,
    this.isStale
  );

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
   * I criteri della tabella: il periodo e i filtri dell'analisi, e nient'altro.
   * Pagina, dimensione e ordinamento restano i predefiniti di `EMPTY_QUERY`:
   * la prima pagina, per data decrescente. Il passo non c'entra: raggruppa i
   * movimenti del grafico, non decide quali sono.
   */
  protected readonly panelQuery = computed<TransactionQueryState>(() => {
    const { from, to } = this.store.dateRange();
    const { types, categoryIds, merchantIds, classification } = this.store.filters();

    return { ...EMPTY_QUERY, from, to, types, categoryIds, merchantIds, classification };
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
    return toQueryParams({ ...this.panelQuery(), ...extra });
  }

  /*
   * I click sui grafici cambiano i filtri dell'analisi, come farebbe chi li
   * tocca nella barra: da lì si aggiornano insieme grafici, tabella e la barra
   * stessa. Sono l'unico modo in cui i grafici agiscono, e nessun filtro cambia
   * senza un gesto (revisione 2 della specifica, 2026-10-05).
   */

  /** «Filtra su questo periodo»: l'analisi passa all'intervallo del bucket, con il passo più comodo per leggerlo. */
  protected onPeriodSelected(selection: TimelineSelection): void {
    this.store.setCustomRange(selection.range.from, selection.range.to);
    this.store.setGranularity(comfortableGranularity(selection.range));
  }

  /**
   * Una categoria entra o esce dai filtri. Senza categoria significa "da
   * classificare": allora si alterna il filtro di classificazione. Nessun
   * filtro di tipo aggiunto: la distribuzione conta le spese, ma restringere
   * ai tipi resta una scelta di chi usa i filtri.
   */
  protected onCategorySelected(categoryId: string | null): void {
    if (categoryId === null) {
      const unclassified = this.store.filters().classification === 'unclassified';
      this.store.setClassification(unclassified ? 'all' : 'unclassified');
    } else {
      this.store.toggleCategory(categoryId);
    }
  }

  /** Un merchant entra o esce dai filtri, senza lasciare la pagina. */
  protected onMerchantSelected(merchantId: string): void {
    this.store.toggleMerchant(merchantId);
  }
}
