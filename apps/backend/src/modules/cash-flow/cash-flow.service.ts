import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { settingsService } from '../settings/index.js';
import {
  affectsNetWorth,
  isExpense,
  isIncome,
  transactionsService,
  type TypeTotal,
} from '../transactions/index.js';
import type { CashFlowViewModel, TypeBreakdown } from './cash-flow.view-model.js';

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Evita di accumulare euro in virgola mobile. */
const toCents = (amount: number): number => Math.round(amount * 100);

const sumCents = (totals: readonly TypeTotal[]): number =>
  totals.reduce((sum, total) => sum + toCents(total.total), 0);

/**
 * Caso d'uso "andamento della liquidità".
 *
 * Parte dal saldo noto indicato nelle impostazioni e vi somma i movimenti.
 * Non possiede dati propri e non conosce SQLite: interroga i servizi pubblici
 * di `settings` e `transactions`.
 */
export const cashFlowService = {
  /**
   * @param month mese da osservare (`YYYY-MM`); se assente considera
   *              tutti i movimenti successivi alla data del saldo noto
   */
  getCashFlow(month?: string | undefined): CashFlowViewModel {
    const period = parseMonth(month);
    const { initialBalance, balanceDate } = settingsService.get();

    // Movimenti del periodo osservato.
    const totals =
      period === null
        ? transactionsService.totalsByTypeInRange(balanceDate, null)
        : transactionsService.totalsByTypeForMonth(period);

    // Quanto è già accaduto fra il saldo noto e l'inizio del periodo.
    const carriedCents =
      period === null
        ? 0
        : sumCents(transactionsService.totalsByTypeInRange(balanceDate, `${period}-01`));

    let netMovementCents = 0;
    let netWorthCents = 0;
    let incomeCents = 0;
    let expensesCents = 0;
    let transactionCount = 0;
    const byType: TypeBreakdown[] = [];

    for (const total of totals) {
      const amountCents = toCents(total.total);

      // Ogni movimento presente in estratto conto ha spostato denaro sul conto.
      netMovementCents += amountCents;
      transactionCount += total.transactionCount;

      if (affectsNetWorth(total.type)) {
        netWorthCents += amountCents;
      }
      if (isIncome(total.type)) {
        incomeCents += amountCents;
      }
      if (isExpense(total.type)) {
        expensesCents -= amountCents;
      }

      byType.push({
        type: total.type,
        amount: amountCents / 100,
        transactionCount: total.transactionCount,
      });
    }

    byType.sort((a, b) => a.amount - b.amount);

    const openingBalanceCents = toCents(initialBalance) + carriedCents;

    return {
      month: period,
      openingBalance: openingBalanceCents / 100,
      balanceDate,
      income: incomeCents / 100,
      expenses: expensesCents / 100,
      netMovement: netMovementCents / 100,
      closingBalance: (openingBalanceCents + netMovementCents) / 100,
      netWorthChange: netWorthCents / 100,
      transactionCount,
      byType,
    };
  },
};

function parseMonth(month: string | undefined): string | null {
  if (month === undefined) {
    return null;
  }

  const parsed = monthSchema.safeParse(month);
  if (!parsed.success) {
    throw new ValidationError('Il mese deve essere indicato nel formato YYYY-MM.');
  }

  return parsed.data;
}
