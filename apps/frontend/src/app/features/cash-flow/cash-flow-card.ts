import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatAmount, formatBookingDate, formatMonth } from '../../core/format';
import { TRANSACTION_TYPE_PLURAL_LABELS } from '../transactions/transaction-type';
import { CashFlow } from './cash-flow.model';

/**
 * Card della liquidità.
 *
 * È puramente presentazionale: riceve i dati dalla dashboard, che è l'unica a
 * conoscere il mese osservato.
 */
@Component({
  selector: 'app-cash-flow-card',
  imports: [RouterLink],
  templateUrl: './cash-flow-card.html',
  styleUrl: './cash-flow-card.scss'
})
export class CashFlowCard {
  readonly cashFlow = input.required<CashFlow>();

  protected readonly typeLabels = TRANSACTION_TYPE_PLURAL_LABELS;
  protected readonly formatAmount = formatAmount;
  protected readonly formatMonth = formatMonth;
  protected readonly formatBookingDate = formatBookingDate;

  /** Il saldo disponibile ha senso solo se l'utente ha indicato un punto di partenza. */
  protected readonly isConfigured = computed(() => this.cashFlow().balanceDate !== null);

  /**
   * Il patrimonio si muove diversamente dal conto quando ci sono prelievi,
   * trasferimenti o prestiti: solo allora vale la pena mostrarlo.
   */
  protected readonly showsNetWorth = computed(
    () => this.cashFlow().netWorthChange !== this.cashFlow().netMovement
  );
}
