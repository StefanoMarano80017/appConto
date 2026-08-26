import { httpResource } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { toErrorMessage } from '../../core/http-error';
import { CategoriesApi } from '../categories/categories.api';
import { Category } from '../categories/category.model';
import { LoanLinks } from '../loans/loan.model';
import { loanLinksRequest } from '../loans/loans.api';
import { MerchantSummary } from '../merchants/merchant.model';
import { MerchantsApi } from '../merchants/merchants.api';
import {
  TransactionQueryState,
  hasFilters,
  parseTransactionQuery,
  toQueryParams
} from './transaction-query';
import { TransactionSortField } from './transaction-query';
import { TransactionPage } from './transaction.model';
import { transactionsRequest } from './transactions.api';
import { TransactionsPagination } from './transactions-pagination';
import { TransactionsTable } from './transactions-table';
import { TransactionsToolbar } from './transactions-toolbar';

/** Quanto attendere prima di cercare: digitare non deve significare una richiesta per tasto. */
const SEARCH_DEBOUNCE_MS = 300;

/** Righe finte mostrate durante il primo caricamento. */
const SKELETON_ROWS = 8;

/**
 * Esplorazione dei movimenti.
 *
 * I criteri vivono nell'URL: ricaricare, tornare indietro, condividere un
 * indirizzo o arrivare da Analytics con un filtro già applicato sono la stessa
 * cosa. Da lì derivano la richiesta e tutto ciò che si vede.
 */
@Component({
  selector: 'app-transactions-page',
  imports: [TransactionsPagination, TransactionsTable, TransactionsToolbar],
  templateUrl: './transactions-page.html',
  styleUrl: './transactions-page.scss'
})
export class TransactionsPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly merchantsApi = inject(MerchantsApi);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap
  });

  protected readonly query = computed(() => parseTransactionQuery(this.params()));
  protected readonly hasFilters = computed(() => hasFilters(this.query()));

  protected readonly transactions = httpResource<TransactionPage>(() =>
    transactionsRequest(this.query())
  );

  /**
   * I legami fra movimenti e prestiti.
   *
   * Arrivano dalla feature `loans`, non dal movimento: la dipendenza resta in
   * un solo verso, e il DTO della transazione non deve sapere cosa sia un
   * prestito. Una sola richiesta, incrociata qui.
   */
  protected readonly loanLinks = httpResource<LoanLinks>(() => loanLinksRequest());

  /** Un elenco (anche vuoto) mostra la colonna; finché non si sa, resta nascosta. */
  protected readonly links = computed(() =>
    this.loanLinks.hasValue() ? this.loanLinks.value().links : null
  );

  /** Il testo digitato, prima che diventi un criterio nell'URL. */
  protected readonly searchText = signal('');
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Servono ai filtri per mostrare nomi al posto di identificativi. */
  protected readonly categories = signal<Category[]>([]);
  protected readonly merchants = signal<MerchantSummary[]>([]);

  protected readonly skeletonRows = Array.from({ length: SKELETON_ROWS });

  protected readonly page = computed<TransactionPage | undefined>(() =>
    this.transactions.hasValue() ? this.transactions.value() : undefined
  );

  protected readonly error = computed(() => {
    const error = this.transactions.error();

    return error === undefined ? null : toErrorMessage(error);
  });

  constructor() {
    // L'URL resta la verità: tornando indietro anche la casella di ricerca lo segue.
    effect(() => this.searchText.set(this.query().search));
  }

  ngOnInit(): void {
    this.categoriesApi.list().subscribe({ next: (categories) => this.categories.set(categories) });
    this.merchantsApi.summary().subscribe({ next: (merchants) => this.merchants.set(merchants) });
  }

  ngOnDestroy(): void {
    if (this.searchTimeout !== null) {
      clearTimeout(this.searchTimeout);
    }
  }

  /**
   * Applica dei criteri navigando: ogni cambiamento è una voce nella cronologia.
   *
   * Qualsiasi modifica ai filtri riporta alla prima pagina — restare sulla
   * pagina 7 di un insieme diverso non significherebbe nulla.
   */
  protected apply(changes: Partial<TransactionQueryState>, replaceUrl = false): void {
    const next: TransactionQueryState = { ...this.query(), page: 1, ...changes };

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toQueryParams(next),
      replaceUrl
    });
  }

  protected onSearchTyped(value: string): void {
    this.searchText.set(value);

    if (this.searchTimeout !== null) {
      clearTimeout(this.searchTimeout);
    }
    // La ricerca sostituisce la voce di cronologia: digitare non riempie il tasto "indietro".
    this.searchTimeout = setTimeout(() => this.apply({ search: value.trim() }, true), SEARCH_DEBOUNCE_MS);
  }

  /** Dopo una modifica si ricaricano entrambi: un tipo corretto cambia le azioni. */
  protected reload(): void {
    this.transactions.reload();
    this.loanLinks.reload();
  }

  protected goToPage(page: number): void {
    this.apply({ page }, false);
  }

  /** La stessa colonna inverte il verso; una colonna nuova parte dal decrescente. */
  protected sortBy(field: TransactionSortField): void {
    const query = this.query();

    this.apply(
      query.sortBy === field
        ? { sortDirection: query.sortDirection === 'asc' ? 'desc' : 'asc' }
        : { sortBy: field, sortDirection: 'desc' }
    );
  }

  protected resetFilters(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }
}
