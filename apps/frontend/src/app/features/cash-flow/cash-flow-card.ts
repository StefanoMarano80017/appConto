import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatAmount, formatBookingDate, formatMonth } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { TRANSACTION_TYPE_PLURAL_LABELS } from '../transactions/transaction-type';
import { CashFlow } from './cash-flow.model';
import { CashFlowApi } from './cash-flow.api';

@Component({
  selector: 'app-cash-flow-card',
  imports: [RouterLink],
  templateUrl: './cash-flow-card.html',
  styleUrl: './cash-flow-card.scss'
})
export class CashFlowCard {
  private readonly api = inject(CashFlowApi);

  /** Mese osservato: arriva dal riepilogo, che è l'unico a possedere lo stato. */
  readonly month = input.required<string>();

  protected readonly cashFlow = signal<CashFlow | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly typeLabels = TRANSACTION_TYPE_PLURAL_LABELS;
  protected readonly formatAmount = formatAmount;
  protected readonly formatMonth = formatMonth;
  protected readonly formatBookingDate = formatBookingDate;

  constructor() {
    effect((onCleanup) => {
      const month = this.month();
      this.loading.set(true);
      this.error.set(null);

      const subscription = this.api.get(month).subscribe({
        next: (cashFlow) => {
          this.cashFlow.set(cashFlow);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(toErrorMessage(error));
          this.cashFlow.set(null);
          this.loading.set(false);
        }
      });

      onCleanup(() => subscription.unsubscribe());
    });
  }

  /** Il saldo disponibile ha senso solo se l'utente ha indicato un punto di partenza. */
  protected isConfigured(cashFlow: CashFlow): boolean {
    return cashFlow.balanceDate !== null;
  }

  /**
   * Il patrimonio si muove diversamente dal conto quando ci sono prelievi,
   * trasferimenti o prestiti: solo allora vale la pena mostrarlo.
   */
  protected showsNetWorth(cashFlow: CashFlow): boolean {
    return cashFlow.netWorthChange !== cashFlow.netMovement;
  }
}
