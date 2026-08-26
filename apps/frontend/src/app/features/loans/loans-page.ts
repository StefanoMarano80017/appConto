import { httpResource } from '@angular/common/http';
import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { formatAmount, formatBookingDate } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import {
  EMPTY_LOAN_QUERY,
  LOAN_STATUS_FILTERS,
  LOAN_STATUS_FILTER_LABELS,
  LoanQueryState,
  LoanSortField,
  hasLoanFilters,
  parseLoanQuery,
  toLoanQueryParams
} from './loan-query';
import { LOAN_STATUS_LABELS, LoanList } from './loan.model';
import { loansRequest } from './loans.api';

/** Quanto attendere prima di cercare: digitare non deve significare una richiesta per tasto. */
const SEARCH_DEBOUNCE_MS = 300;

/** Una card della fascia superiore. */
interface Kpi {
  label: string;
  value: string;
  tone: 'positive' | 'negative' | 'neutral';
}

/** Le colonne della tabella; `field` è `null` dove non ha senso ordinare. */
const COLUMNS: readonly { label: string; field: LoanSortField | null; numeric: boolean }[] = [
  { label: 'Persona', field: 'borrower', numeric: false },
  { label: 'Descrizione', field: null, numeric: false },
  { label: 'Data', field: 'lentAt', numeric: false },
  { label: 'Prestato', field: 'amount', numeric: true },
  { label: 'Restituito', field: null, numeric: true },
  { label: 'Residuo', field: 'remainingAmount', numeric: true },
  { label: 'Stato', field: null, numeric: false }
];

/**
 * Workspace dei prestiti.
 *
 * Risponde ad una sola domanda: quanto denaro devo ancora ricevere, e da chi.
 * I criteri vivono nell'URL, come nell'esplorazione dei movimenti, e i totali
 * in alto sono la somma delle righe sotto — non un conto separato.
 */
@Component({
  selector: 'app-loans-page',
  imports: [RouterLink],
  templateUrl: './loans-page.html',
  styleUrl: './loans-page.scss'
})
export class LoansPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap
  });

  protected readonly query = computed(() => parseLoanQuery(this.params()));
  protected readonly hasFilters = computed(() => hasLoanFilters(this.query()));

  protected readonly loans = httpResource<LoanList>(() => loansRequest(this.query()));

  /** Il testo digitato, prima che diventi un criterio nell'URL. */
  protected readonly searchText = signal('');
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  protected readonly columns = COLUMNS;
  protected readonly statusFilters = LOAN_STATUS_FILTERS;
  protected readonly statusFilterLabels = LOAN_STATUS_FILTER_LABELS;
  protected readonly statusLabels = LOAN_STATUS_LABELS;
  protected readonly formatAmount = formatAmount;
  protected readonly formatBookingDate = formatBookingDate;

  protected readonly data = computed<LoanList | undefined>(() =>
    this.loans.hasValue() ? this.loans.value() : undefined
  );

  protected readonly error = computed(() => {
    const error = this.loans.error();

    return error === undefined ? null : toErrorMessage(error);
  });

  /**
   * Le card della fascia superiore.
   *
   * «Da ricevere» è la cifra che conta: è l'unica che dice quanto denaro è
   * ancora fuori casa.
   */
  protected readonly kpis = computed<Kpi[]>(() => {
    const totals = this.data()?.totals;
    if (totals === undefined) {
      return [];
    }

    return [
      { label: 'Prestato', value: formatAmount(totals.lent), tone: 'neutral' },
      { label: 'Restituito', value: formatAmount(totals.repaid), tone: 'positive' },
      {
        label: 'Da ricevere',
        value: formatAmount(totals.remaining),
        tone: totals.remaining > 0 ? 'negative' : 'positive'
      },
      { label: 'Aperti', value: String(totals.openCount), tone: 'neutral' }
    ];
  });

  constructor() {
    // L'URL resta la verità: tornando indietro anche la casella di ricerca lo segue.
    effect(() => this.searchText.set(this.query().search));
  }

  ngOnDestroy(): void {
    if (this.searchTimeout !== null) {
      clearTimeout(this.searchTimeout);
    }
  }

  /** Il valore di `aria-sort` della colonna, per chi usa uno screen reader. */
  protected ariaSort(field: LoanSortField | null): 'ascending' | 'descending' | 'none' {
    if (field === null || this.query().sortBy !== field) {
      return 'none';
    }

    return this.query().sortDirection === 'asc' ? 'ascending' : 'descending';
  }

  protected apply(changes: Partial<LoanQueryState>, replaceUrl = false): void {
    const next: LoanQueryState = { ...this.query(), ...changes };

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toLoanQueryParams(next),
      replaceUrl
    });
  }

  protected onSearchTyped(value: string): void {
    this.searchText.set(value);

    if (this.searchTimeout !== null) {
      clearTimeout(this.searchTimeout);
    }
    // La ricerca sostituisce la voce di cronologia: digitare non riempie il tasto "indietro".
    this.searchTimeout = setTimeout(
      () => this.apply({ search: value.trim() }, true),
      SEARCH_DEBOUNCE_MS
    );
  }

  /** La stessa colonna inverte il verso; una colonna nuova parte dal decrescente. */
  protected sortBy(field: LoanSortField): void {
    const query = this.query();

    this.apply(
      query.sortBy === field
        ? { sortDirection: query.sortDirection === 'asc' ? 'desc' : 'asc' }
        : { sortBy: field, sortDirection: 'desc' }
    );
  }

  protected resetFilters(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toLoanQueryParams(EMPTY_LOAN_QUERY)
    });
  }
}
