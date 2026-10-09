import { httpResource } from '@angular/common/http';
import { Component, computed, input, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toErrorMessage } from '../../core/http-error';
import { Panel } from '../../shared/layout/panel';
import { SectionHeader } from '../../shared/layout/section-header';
import { EmptyState } from '../../shared/ui/empty-state';
import { ErrorRetry } from '../../shared/ui/error-retry';
import { TransactionsTable } from '../../shared/ui/transactions-table';
import type {
  TransactionsTableSortDirection,
  TransactionsTableSortField,
} from '../../shared/ui/transactions-table.model';
import { TransactionQueryState, toQueryParams } from '../transactions/transaction-query';
import { TransactionPage } from '../transactions/transaction.model';
import { TRANSACTION_TYPE_OPTIONS } from '../transactions/transaction-type-options';
import { transactionsRequest } from '../transactions/transactions.api';

/**
 * Le transazioni dietro l'analisi: quelle dei filtri correnti, nient'altro.
 *
 * Un'anteprima, non l'esplorazione: la prima pagina, in sola lettura, e un
 * collegamento che apre gli stessi criteri in Movimenti. I criteri arrivano
 * già pronti dalla pagina, che li compone dai filtri dell'analisi: il pannello
 * non ne aggiunge di suoi e non ha comandi per cambiarli. Un click su un
 * grafico cambia i filtri, e da lì questa tabella si aggiorna come ogni altra
 * sezione (revisione 2 della specifica, 2026-10-05).
 *
 * Il pannello sta sempre sotto l'andamento, quindi un cambio di filtri non lo
 * porta in vista né gli dà il focus: chi ha cliccato lo vede già cambiare
 * dov'è. Per questo l'intestazione è un `SectionHeader` qualunque — il titolo
 * non riceve il focus (§16.1 della proposta sui componenti condivisi).
 */
@Component({
  selector: 'app-analytics-transactions',
  imports: [Panel, SectionHeader, EmptyState, ErrorRetry, TransactionsTable, RouterLink],
  templateUrl: './analytics-transactions.html',
  styleUrl: './analytics-transactions.scss',
})
export class AnalyticsTransactions {
  readonly query = input.required<TransactionQueryState>();

  protected readonly typeOptions = TRANSACTION_TYPE_OPTIONS;
  protected readonly toQueryParams = toQueryParams;
  protected readonly sortBy = signal<TransactionsTableSortField>('bookingDate');
  protected readonly sortDirection = signal<TransactionsTableSortDirection>('desc');

  protected readonly transactions = httpResource<TransactionPage>(() =>
    transactionsRequest({
      ...this.query(),
      sortBy: this.sortBy(),
      sortDirection: this.sortDirection(),
    }),
  );

  /**
   * L'ultima pagina caricata, che resta a schermo mentre ne arriva un'altra.
   *
   * Come in `AnalyticsPage`: `httpResource` azzera il valore quando la
   * richiesta cambia, e un filtro nuovo farebbe sparire e ricomparire la
   * tabella. Le righe di prima appartengono sempre a ciò che si sta guardando
   * — le transazioni dei filtri — quindi restano, attenuate, a ogni ricarica.
   */
  protected readonly page = linkedSignal<TransactionPage | undefined, TransactionPage | undefined>({
    source: () => (this.transactions.hasValue() ? this.transactions.value() : undefined),
    computation: (caricata, precedente) => caricata ?? precedente?.value,
  });

  protected readonly error = computed(() => {
    const error = this.transactions.error();

    return error === undefined ? null : toErrorMessage(error);
  });

  /** Tutte le transazioni dei criteri stanno nella pagina: il totale della tabella è quello vero. */
  protected readonly complete = computed(() => {
    const page = this.page();

    return page !== undefined && page.items.length === page.pagination.total;
  });

  protected onSortSelected(field: TransactionsTableSortField): void {
    if (this.sortBy() === field) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      return;
    }

    this.sortBy.set(field);
    this.sortDirection.set('desc');
  }
}
