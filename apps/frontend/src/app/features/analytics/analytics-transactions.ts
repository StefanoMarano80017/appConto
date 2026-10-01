import { httpResource } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideX } from '@lucide/angular';
import { toErrorMessage } from '../../core/http-error';
import { Panel } from '../../shared/layout/panel';
import { EmptyState } from '../../shared/ui/empty-state';
import { ErrorRetry } from '../../shared/ui/error-retry';
import { TransactionsTable } from '../../shared/ui/transactions-table';
import { TransactionQueryState, toQueryParams } from '../transactions/transaction-query';
import { TransactionPage } from '../transactions/transaction.model';
import { TRANSACTION_TYPE_OPTIONS } from '../transactions/transaction-type-options';
import { transactionsRequest } from '../transactions/transactions.api';
import { AnalyticsSelectionValue, selectionLabel } from './analytics-selection';

/**
 * Le transazioni dietro l'elemento del grafico selezionato.
 *
 * Un'anteprima, non l'esplorazione: la prima pagina, in sola lettura, e un
 * collegamento che apre la stessa selezione in Movimenti. I criteri arrivano
 * già pronti dalla pagina, che li compone da quelli dell'analisi e da quelli
 * dell'elemento.
 *
 * L'intestazione non è un `SectionHeader`: il titolo deve ricevere il focus, e
 * l'`h2` di quel componente non accetta un `tabindex`
 * (docs/architecture/frontend-shared-components-proposal.md, §16.1).
 */
@Component({
  selector: 'app-analytics-transactions',
  imports: [Panel, EmptyState, ErrorRetry, TransactionsTable, RouterLink, LucideX],
  templateUrl: './analytics-transactions.html',
  styleUrl: './analytics-transactions.scss',
})
export class AnalyticsTransactions {
  readonly selection = input.required<AnalyticsSelectionValue>();
  readonly query = input.required<TransactionQueryState>();

  readonly closed = output<void>();

  protected readonly typeOptions = TRANSACTION_TYPE_OPTIONS;
  protected readonly toQueryParams = toQueryParams;

  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');

  protected readonly title = computed(() => `Transazioni · ${selectionLabel(this.selection())}`);

  protected readonly transactions = httpResource<TransactionPage>(() =>
    transactionsRequest(this.query()),
  );

  /**
   * L'ultima pagina caricata, che resta a schermo mentre ne arriva un'altra.
   *
   * Come in `AnalyticsPage`: `httpResource` azzera il valore quando la
   * richiesta cambia, e passare da un elemento all'altro farebbe sparire e
   * ricomparire la tabella.
   */
  protected readonly page = linkedSignal<TransactionPage | undefined, TransactionPage | undefined>({
    source: () => (this.transactions.hasValue() ? this.transactions.value() : undefined),
    computation: (caricata, precedente) => caricata ?? precedente?.value,
  });

  protected readonly error = computed(() => {
    const error = this.transactions.error();

    return error === undefined ? null : toErrorMessage(error);
  });

  /** Tutte le transazioni della selezione stanno nella pagina: il totale della tabella è quello vero. */
  protected readonly complete = computed(() => {
    const page = this.page();

    return page !== undefined && page.items.length === page.pagination.total;
  });

  constructor() {
    // A ogni nuova selezione, a pannello reso: chi ha cliccato sul grafico deve
    // vedere dove sono finite le righe, e da tastiera ritrovarsi sul titolo.
    effect(() => {
      this.selection();

      afterNextRender(
        () => {
          this.host.nativeElement.scrollIntoView({ block: 'nearest' });
          this.heading().nativeElement.focus();
        },
        { injector: this.injector },
      );
    });
  }
}
