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
import { TransactionsApi, transactionsRequest } from './transactions.api';
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
  private readonly api = inject(TransactionsApi);

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

  /**
   * I movimenti selezionati.
   *
   * Vivono qui e non nella tabella: la tabella viene ricostruita a ogni
   * ricaricamento dei dati, e una selezione che vive dentro di essa sparirebbe
   * ogni volta che si corregge un tipo o una categoria.
   *
   * Sono identificativi e non righe: l'insieme resta valido anche quando la
   * pagina mostrata cambia.
   */
  protected readonly selected = signal<ReadonlySet<string>>(new Set<string>());

  protected readonly selectedCount = computed(() => this.selected().size);

  /** Lo stato dell'eliminazione: prima si chiede conferma, poi si esegue. */
  protected readonly confirmingDelete = signal(false);
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal<string | null>(null);
  protected readonly deleteDone = signal<string | null>(null);

  constructor() {
    // L'URL resta la verità: tornando indietro anche la casella di ricerca lo segue.
    effect(() => this.searchText.set(this.query().search));

    /*
     * Cambiando i criteri la selezione si azzera.
     *
     * Restare selezionati fuori da ciò che si vede sarebbe un'insidia: si
     * filtra, si seleziona il visibile, si toglie il filtro, e il pulsante
     * direbbe «elimina 40 movimenti» di cui trentacinque non più a schermo.
     */
    effect(() => {
      this.query();
      this.selected.set(new Set<string>());
      this.confirmingDelete.set(false);
      this.deleteError.set(null);
      this.deleteDone.set(null);
    });
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

  /** Inverte la selezione di una riga. */
  protected toggleSelection(id: string): void {
    this.selected.update((corrente) => {
      const prossimo = new Set(corrente);
      if (!prossimo.delete(id)) {
        prossimo.add(id);
      }

      return prossimo;
    });

    // Cambiando la selezione, una conferma in sospeso non riguarda più ciò che
    // era stato scelto.
    this.confirmingDelete.set(false);
  }

  /**
   * Seleziona o deseleziona i movimenti **mostrati**.
   *
   * Solo quelli: «tutti» in una tabella paginata non può significare gli
   * ottocento che stanno dietro al filtro, perché non sono a schermo e non si
   * possono guardare prima di eliminarli.
   */
  protected toggleAll(select: boolean): void {
    const mostrati = this.page()?.items.map((movimento) => movimento.id) ?? [];

    this.selected.update((corrente) => {
      const prossimo = new Set(corrente);
      for (const id of mostrati) {
        if (select) {
          prossimo.add(id);
        } else {
          prossimo.delete(id);
        }
      }

      return prossimo;
    });

    this.confirmingDelete.set(false);
  }

  protected clearSelection(): void {
    this.selected.set(new Set<string>());
    this.confirmingDelete.set(false);
    this.deleteError.set(null);
  }

  /** Il primo clic chiede conferma; il secondo elimina. */
  protected askDelete(): void {
    this.deleteError.set(null);
    this.deleteDone.set(null);
    this.confirmingDelete.set(true);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(false);
  }

  /**
   * Elimina la selezione.
   *
   * Una sola richiesta per l'intero insieme: il backend la esegue tutta o
   * niente, quindi non esiste uno stato in cui metà dei movimenti scelti è
   * stata eliminata.
   */
  protected deleteSelected(): void {
    const ids = [...this.selected()];
    if (ids.length === 0 || this.deleting()) {
      return;
    }

    this.deleting.set(true);
    this.deleteError.set(null);

    this.api.deleteMany(ids).subscribe({
      next: (esito) => {
        this.deleting.set(false);
        this.confirmingDelete.set(false);
        this.selected.set(new Set<string>());
        this.deleteDone.set(
          esito.notFound.length === 0
            ? `${String(esito.deleted)} ${esito.deleted === 1 ? 'movimento eliminato' : 'movimenti eliminati'}.`
            : `${String(esito.deleted)} eliminati; ${String(esito.notFound.length)} non esistevano più.`
        );
        this.reload();
      },
      error: (error: unknown) => {
        this.deleting.set(false);
        this.confirmingDelete.set(false);
        // La selezione **resta**: il messaggio dice cosa toglierne, e
        // ricominciare da zero sarebbe una punizione.
        this.deleteError.set(toErrorMessage(error));
      }
    });
  }
}
