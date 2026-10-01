import { httpResource } from '@angular/common/http';
import { Component, computed, input, linkedSignal, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toErrorMessage } from '../../core/http-error';
import { Panel } from '../../shared/layout/panel';
import { SectionHeader } from '../../shared/layout/section-header';
import { EmptyState } from '../../shared/ui/empty-state';
import { ErrorRetry } from '../../shared/ui/error-retry';
import { TransactionsTable } from '../../shared/ui/transactions-table';
import { TransactionQueryState, toQueryParams } from '../transactions/transaction-query';
import { TransactionPage } from '../transactions/transaction.model';
import { TRANSACTION_TYPE_OPTIONS } from '../transactions/transaction-type-options';
import { transactionsRequest } from '../transactions/transactions.api';
import { AnalyticsSelectionValue, selectionLabel } from './analytics-selection';

/** Una pagina caricata, con la selezione a cui appartiene (`null`: il periodo intero). */
interface LoadedPage {
  selection: AnalyticsSelectionValue | null;
  page: TransactionPage;
}

/**
 * Le transazioni dietro l'analisi: quelle del periodo, o quelle dell'elemento
 * del grafico selezionato.
 *
 * Un'anteprima, non l'esplorazione: la prima pagina, in sola lettura, e un
 * collegamento che apre gli stessi criteri in Movimenti. I criteri arrivano
 * già pronti dalla pagina, che li compone da quelli dell'analisi e, se c'è,
 * da quelli dell'elemento.
 *
 * Il pannello sta sempre sotto l'andamento, quindi una selezione non lo porta
 * in vista né gli dà il focus: chi ha cliccato lo vede già cambiare dov'è.
 * Per questo l'intestazione è di nuovo un `SectionHeader` qualunque — il
 * titolo non deve più ricevere il focus (§16.1 della proposta sui componenti
 * condivisi).
 */
@Component({
  selector: 'app-analytics-transactions',
  imports: [Panel, SectionHeader, EmptyState, ErrorRetry, TransactionsTable, RouterLink],
  templateUrl: './analytics-transactions.html',
  styleUrl: './analytics-transactions.scss',
})
export class AnalyticsTransactions {
  /** L'elemento selezionato; `null` quando si guarda il periodo intero. */
  readonly selection = input.required<AnalyticsSelectionValue | null>();
  readonly query = input.required<TransactionQueryState>();

  /** «Mostra tutto»: chi usa il pannello toglie la selezione e torna al periodo. */
  readonly cleared = output<void>();

  protected readonly typeOptions = TRANSACTION_TYPE_OPTIONS;
  protected readonly toQueryParams = toQueryParams;

  protected readonly title = computed(() => {
    const selection = this.selection();

    return selection === null
      ? 'Transazioni del periodo'
      : `Transazioni · ${selectionLabel(selection)}`;
  });

  protected readonly transactions = httpResource<TransactionPage>(() =>
    transactionsRequest(this.query()),
  );

  /**
   * L'ultima pagina caricata, che resta a schermo mentre ne arriva un'altra.
   *
   * Come in `AnalyticsPage`: `httpResource` azzera il valore quando la
   * richiesta cambia, e un filtro nuovo farebbe sparire e ricomparire la
   * tabella. Vale però solo per la stessa selezione: cambiata quella, le righe
   * di prima non le appartengono più e si torna al caricamento. «Nessuna
   * selezione» conta come una selezione a sé: `null === null`, quindi un
   * filtro cambiato sul periodo intero tiene le righe attenuate, mentre
   * passare dal periodo a un elemento (o tornare indietro) no.
   */
  private readonly loaded = linkedSignal<
    { selection: AnalyticsSelectionValue | null; page: TransactionPage | undefined },
    LoadedPage | undefined
  >({
    source: () => ({
      selection: this.selection(),
      page: this.transactions.hasValue() ? this.transactions.value() : undefined,
    }),
    computation: ({ selection, page }, precedente) =>
      page !== undefined
        ? { selection, page }
        : precedente?.value !== undefined && precedente.value.selection === selection
          ? precedente.value
          : undefined,
  });

  protected readonly page = computed(() => this.loaded()?.page);

  protected readonly error = computed(() => {
    const error = this.transactions.error();

    return error === undefined ? null : toErrorMessage(error);
  });

  /** Tutte le transazioni dei criteri stanno nella pagina: il totale della tabella è quello vero. */
  protected readonly complete = computed(() => {
    const page = this.page();

    return page !== undefined && page.items.length === page.pagination.total;
  });
}
