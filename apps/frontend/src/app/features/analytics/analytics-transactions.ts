import { httpResource } from '@angular/common/http';
import { Component, computed, input, linkedSignal, signal } from '@angular/core';
import { toErrorMessage } from '../../core/http-error';
import { TransactionsTablePanel } from '../../shared/ui/transactions-table-panel';
import type {
  TransactionsTableSortDirection,
  TransactionsTableSortField,
} from '../../shared/ui/transactions-table.model';
import { EMPTY_QUERY, TransactionQueryState } from '../transactions/transaction-query';
import { TransactionPage } from '../transactions/transaction.model';
import { TRANSACTION_TYPE_OPTIONS } from '../transactions/transaction-type-options';
import { transactionsRequest } from '../transactions/transactions.api';

/**
 * Le transazioni dietro l'analisi: quelle dei filtri correnti, nient'altro.
 *
 * Tutte, sfogliabili pagina per pagina, in sola lettura: lo stesso pannello
 * di Movimenti (`TransactionsTablePanel`), senza selezione né correzioni. I
 * criteri arrivano già pronti dalla pagina, che li compone dai filtri
 * dell'analisi: il pannello non ne aggiunge di suoi e non ha comandi per
 * cambiarli. Suoi sono solo pagina, dimensione della pagina e ordinamento,
 * che riguardano come si legge l'elenco e non quali transazioni contiene.
 *
 * Un click su un grafico cambia i filtri, e da lì questa tabella si aggiorna
 * come ogni altra sezione (revisione 2 della specifica, 2026-10-05).
 *
 * Il pannello sta sempre sotto l'andamento, quindi un cambio di filtri non lo
 * porta in vista né gli dà il focus: chi ha cliccato lo vede già cambiare
 * dov'è. Per questo il titolo è il `SectionHeader` qualunque che il pannello
 * condiviso disegna — non riceve il focus (§16.1 della proposta sui
 * componenti condivisi).
 */
@Component({
  selector: 'app-analytics-transactions',
  imports: [TransactionsTablePanel],
  templateUrl: './analytics-transactions.html',
  styleUrl: './analytics-transactions.scss',
})
export class AnalyticsTransactions {
  readonly query = input.required<TransactionQueryState>();

  protected readonly typeOptions = TRANSACTION_TYPE_OPTIONS;
  protected readonly sortBy = signal<TransactionsTableSortField>('bookingDate');
  protected readonly sortDirection = signal<TransactionsTableSortDirection>('desc');
  protected readonly pageSize = signal(EMPTY_QUERY.pageSize);

  /**
   * La pagina richiesta, che torna alla prima a ogni cambio di criteri,
   * ordinamento o dimensione della pagina.
   *
   * Restare sulla pagina 7 di un insieme diverso non significherebbe nulla:
   * stessa regola di Movimenti, dove ogni modifica ai filtri riporta alla
   * prima pagina. Un `linkedSignal` e non un `effect`, così la richiesta parte
   * già con la pagina giusta invece di partire con quella vecchia e poi
   * ripartire.
   */
  protected readonly pageNumber = linkedSignal({
    source: () => ({
      query: this.query(),
      sortBy: this.sortBy(),
      sortDirection: this.sortDirection(),
      pageSize: this.pageSize(),
    }),
    computation: () => 1,
  });

  protected readonly transactions = httpResource<TransactionPage>(() =>
    transactionsRequest({
      ...this.query(),
      page: this.pageNumber(),
      pageSize: this.pageSize(),
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

  /**
   * Tutte le transazioni dei criteri stanno nella pagina: il totale della
   * tabella è quello vero.
   *
   * Solo allora la tabella mostra la riga di totale: su una pagina parziale
   * sommerebbe le sole righe mostrate, e un totale di 25 transazioni su 312
   * sembrerebbe quello del periodo.
   */
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
