import { httpResource } from '@angular/common/http';
import {
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { formatBookingDate } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { Panel } from '@shared/layout/panel/panel';
import { PanelContentComponent } from '@shared/layout/panel/panel-content';
import { PageLayout } from '@shared/layout/page-layout/page-layout';
import { SectionHeader } from '@shared/layout/section-header/section-header';
import { Amount } from '@shared/ui/data/amount/amount';
import { Pagination } from '@shared/ui/data/pagination/pagination';
import { SortableHeader } from '@shared/ui/data/sortable-header/sortable-header';
import { EmptyState } from '@shared/ui/feedback/empty-state/empty-state';
import { ErrorRetry } from '@shared/ui/feedback/error-retry/error-retry';
import { ChoiceGroup, ChoiceOption } from '@shared/ui/forms/choice-group/choice-group';
import { SearchInput } from '@shared/ui/forms/search-input/search-input';
import { Select } from '@shared/ui/forms/select/select';
import { Category } from '../categories/category.model';
import {
  ClassificationFilter,
  FIRST_SORT_DIRECTION,
  MerchantQueryState,
  MerchantSortField,
  parseMerchantQuery,
  toMerchantQueryParams,
} from './merchant-query';
import { Merchant, MerchantPage, MerchantSummary } from './merchant.model';
import { MerchantsApi, merchantsRequest } from './merchants.api';

/** Quanto attendere prima di cercare: digitare non deve significare una richiesta per tasto. */
const SEARCH_DEBOUNCE_MS = 300;

/** Quante righe finte mostra lo skeleton del primo caricamento. */
const SKELETON_ROWS = 8;

/** Le colonne della tabella, tutte ordinabili. */
const COLUMNS: readonly { label: string; field: MerchantSortField; numeric: boolean }[] = [
  { label: 'Nome', field: 'name', numeric: false },
  { label: 'Categoria', field: 'category', numeric: false },
  { label: 'Transazioni', field: 'transactionCount', numeric: true },
  { label: 'Totale speso', field: 'totalSpent', numeric: true },
  { label: 'Ultima transazione', field: 'lastTransactionDate', numeric: false },
];

/**
 * Classificazione dei merchant.
 *
 * Filtro, ricerca, ordinamento e pagina vivono nell'URL e il backend fa il
 * resto: la pagina mostra una fetta e, dopo ogni salvataggio, ricarica la
 * stessa fetta senza perdere il punto.
 */
@Component({
  selector: 'app-merchants-page',
  imports: [
    Amount,
    ChoiceGroup,
    EmptyState,
    ErrorRetry,
    PageLayout,
    Pagination,
    Panel,
    PanelContentComponent,
    SearchInput,
    SectionHeader,
    Select,
    SortableHeader,
  ],
  templateUrl: './merchants-page.html',
  styleUrl: './merchants-page.scss',
})
export class MerchantsPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(MerchantsApi);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly query = computed(() => parseMerchantQuery(this.params()));

  protected readonly merchants = httpResource<MerchantPage>(() => merchantsRequest(this.query()));

  protected readonly categoriesResource = httpResource<Category[]>(() => ({
    url: `${API_BASE_URL}/categories`,
  }));

  protected readonly categories = computed(() =>
    this.categoriesResource.hasValue() ? this.categoriesResource.value() : [],
  );

  /**
   * L'ultima pagina caricata, che resta a schermo mentre ne arriva un'altra.
   *
   * `reload()` conserva da solo il valore, ma cambiando la richiesta (un
   * ordinamento, un filtro) `httpResource` lo azzera: senza questo la tabella
   * sparirebbe e ricomparirebbe a ogni clic. Lo skeleton resta così per il
   * solo primo caricamento.
   */
  protected readonly data = linkedSignal<MerchantPage | undefined, MerchantPage | undefined>({
    source: () => (this.merchants.hasValue() ? this.merchants.value() : undefined),
    computation: (caricata, precedente) => caricata ?? precedente?.value,
  });

  protected readonly error = computed(() => {
    const error = this.merchants.error();

    return error === undefined ? null : toErrorMessage(error);
  });

  /** Le voci del filtro, con il conteggio sull'intero archivio. */
  protected readonly filterOptions = computed<ChoiceOption<ClassificationFilter>[]>(() => {
    const counts = this.data()?.counts;
    const count = (value: number | undefined): string => (value === undefined ? '' : ` (${value})`);

    return [
      { id: 'all', label: `Tutti${count(counts?.all)}` },
      { id: 'classified', label: `Classificati${count(counts?.classified)}` },
      { id: 'unclassified', label: `Da classificare${count(counts?.unclassified)}` },
    ];
  });

  /**
   * La pagina richiesta è oltre l'ultima, ma i risultati ci sono: capita
   * classificando l'ultima riga dell'ultima pagina. Si resta qui e lo si dice.
   */
  protected readonly emptyPage = computed(() => {
    const data = this.data();

    return data !== undefined && data.items.length === 0 && data.pagination.total > 0;
  });

  /** Il testo digitato, prima che diventi un criterio nell'URL. */
  protected readonly searchText = signal('');
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  /** L'errore dell'ultimo salvataggio, mostrato sopra la tabella. */
  protected readonly saveError = signal<string | null>(null);
  /** Merchant con una modifica in corso. */
  protected readonly savingId = signal<string | null>(null);

  protected readonly columns = COLUMNS;
  protected readonly skeletonRows = Array.from({ length: SKELETON_ROWS });
  protected readonly formatBookingDate = formatBookingDate;

  constructor() {
    // L'URL resta la verità: tornando indietro anche la casella di ricerca lo segue.
    effect(() => this.searchText.set(this.query().search));
  }

  ngOnDestroy(): void {
    if (this.searchTimeout !== null) {
      clearTimeout(this.searchTimeout);
    }
  }

  /**
   * Applica dei criteri navigando.
   *
   * Qualsiasi modifica che non sia la sola pagina riporta alla prima: restare
   * sulla pagina 7 di un insieme diverso non significherebbe nulla.
   */
  protected apply(changes: Partial<MerchantQueryState>, replaceUrl = false): void {
    const onlyPage = Object.keys(changes).every((key) => key === 'page');
    const next: MerchantQueryState = { ...this.query(), ...(onlyPage ? {} : { page: 1 }), ...changes };

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toMerchantQueryParams(next),
      replaceUrl,
    });
  }

  protected onSearchTyped(value: string): void {
    this.searchText.set(value);

    if (this.searchTimeout !== null) {
      clearTimeout(this.searchTimeout);
    }
    // La ricerca sostituisce la voce di cronologia: digitare non riempie il tasto "indietro".
    // Uno spazio in più non cambia il criterio: niente navigazione, e la pagina resta quella.
    this.searchTimeout = setTimeout(() => {
      const search = value.trim();
      if (search !== this.query().search) {
        this.apply({ search }, true);
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  /** La stessa colonna inverte il verso; una colonna nuova parte dal suo verso naturale. */
  protected sortBy(field: MerchantSortField): void {
    const query = this.query();

    this.apply(
      query.sortBy === field
        ? { sortDirection: query.sortDirection === 'asc' ? 'desc' : 'asc' }
        : { sortBy: field, sortDirection: FIRST_SORT_DIRECTION[field] },
    );
  }

  /** Toglie ricerca e filtro, tenendo ordinamento e dimensione della pagina. */
  protected resetSearch(): void {
    this.apply({ search: '', classification: 'all' });
  }

  protected changeCategory(merchant: MerchantSummary, categoryId: string | null): void {
    if ((merchant.category?.id ?? null) === categoryId) {
      return;
    }

    this.save(merchant.id, this.api.updateCategory(merchant.id, categoryId));
  }

  protected rename(merchant: MerchantSummary, value: string): void {
    const displayName = value.trim();
    if (displayName === (merchant.displayName ?? '')) {
      return;
    }

    this.save(merchant.id, this.api.updateDisplayName(merchant.id, displayName));
  }

  /**
   * Salva e ricarica la pagina corrente, riuscita o no la modifica.
   *
   * Dopo un successo la riga che non soddisfa più il filtro sparisce e la
   * successiva risale; dopo un errore la riga torna al valore salvato.
   */
  private save(merchantId: string, request: Observable<Merchant>): void {
    this.savingId.set(merchantId);
    this.saveError.set(null);

    request.subscribe({
      next: () => {
        this.savingId.set(null);
        this.merchants.reload();
      },
      error: (error: unknown) => {
        this.saveError.set(toErrorMessage(error));
        this.savingId.set(null);
        this.merchants.reload();
      },
    });
  }
}
