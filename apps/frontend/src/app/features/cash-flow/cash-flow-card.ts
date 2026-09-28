import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatBookingDate, formatMonth } from '../../core/format';
import { Panel } from '../../shared/layout/panel';
import { SectionHeader } from '../../shared/layout/section-header';
import { Amount } from '../../shared/ui/amount';
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
  imports: [Panel, RouterLink, SectionHeader, Amount],
  templateUrl: './cash-flow-card.html',
  styleUrl: './cash-flow-card.scss'
})
export class CashFlowCard {
  readonly cashFlow = input.required<CashFlow>();

  protected readonly typeLabels = TRANSACTION_TYPE_PLURAL_LABELS;
  protected readonly formatMonth = formatMonth;
  protected readonly formatBookingDate = formatBookingDate;

  /** Il saldo disponibile ha senso solo se l'utente ha indicato un punto di partenza. */
  protected readonly isConfigured = computed(() => this.cashFlow().balanceDate !== null);

  protected readonly subtitle = computed(() => {
    const balanceDate = this.cashFlow().balanceDate;
    return balanceDate === null ? undefined : `Saldo noto al ${formatBookingDate(balanceDate)}`;
  });

  /**
   * Il patrimonio si muove diversamente dal conto quando ci sono prelievi,
   * trasferimenti o prestiti: solo allora vale la pena mostrarlo.
   */
  protected readonly showsNetWorth = computed(
    () => this.cashFlow().netWorthChange !== this.cashFlow().netMovement
  );
}
