import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { loansService, type LoanAllocation } from '../loans/index.js';
import { settingsService } from '../settings/index.js';
import {
  expenseCents,
  isIncome,
  netWorthCents,
  transactionsService,
  transactionTypeSchema,
  type TypeTotal,
} from '../transactions/index.js';
import type { CashFlowViewModel, TypeBreakdown } from './cash-flow.view-model.js';

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Evita di accumulare euro in virgola mobile. */
const toCents = (amount: number): number => Math.round(amount * 100);

const sumCents = (totals: readonly TypeTotal[]): number =>
  totals.reduce((sum, total) => sum + toCents(total.total), 0);

/**
 * Quanto dei movimenti di tipo prestito del periodo è in realtà spesa propria.
 *
 * I totali per tipo sanno che 1.920 € sono usciti come prestito, non che 890 di
 * quelli non sono stati prestati a nessuno: quel dettaglio vive nella feature
 * `loans`, ed è l'unico motivo per cui il cash flow la interroga.
 *
 * Il tipo del movimento viene ricontrollato: se nel frattempo è stato corretto
 * a "spesa", i totali per tipo lo contano già per intero e sommarvi la quota
 * significherebbe contarla due volte.
 */
function ownExpenseCents(
  allocations: readonly LoanAllocation[],
  inPeriod: (bookingDate: string) => boolean,
): number {
  return allocations.reduce((sum, allocation) => {
    const type = transactionTypeSchema.safeParse(allocation.type);
    if (!type.success || type.data !== 'LOAN' || !inPeriod(allocation.bookingDate)) {
      return sum;
    }

    return sum + expenseCents(type.data, allocation.amountCents, allocation.lentCents);
  }, 0);
}

/**
 * Caso d'uso "andamento della liquidità".
 *
 * Parte dal saldo noto indicato nelle impostazioni e vi somma i movimenti.
 * Non possiede dati propri e non conosce SQLite: interroga i servizi pubblici
 * di `settings`, `transactions` e `loans`.
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

    // Lo stesso periodo, per la ripartizione dei prestiti: gli estremi
    // ricalcano quelli delle due letture qui sopra.
    const inPeriod =
      period === null
        ? (date: string): boolean => balanceDate === null || date > balanceDate
        : (date: string): boolean => date.startsWith(`${period}-`);

    // Quanto è già accaduto fra il saldo noto e l'inizio del periodo.
    const carriedCents =
      period === null
        ? 0
        : sumCents(transactionsService.totalsByTypeInRange(balanceDate, `${period}-01`));

    let netMovementCents = 0;
    let netWorthChangeCents = 0;
    let incomeCents = 0;
    let expensesCents = 0;
    let transactionCount = 0;
    const byType: TypeBreakdown[] = [];

    for (const total of totals) {
      const amountCents = toCents(total.total);

      // Ogni movimento presente in estratto conto ha spostato denaro sul conto.
      netMovementCents += amountCents;
      transactionCount += total.transactionCount;

      /*
       * I totali sono aggregati per tipo, non per movimento: la ripartizione
       * fra spesa e credito di un prestito parziale non è ricavabile da qui e
       * viene sommata dopo il ciclo. Con `lentCents` a zero queste due
       * funzioni valgono quanto valevano prima che i prestiti esistessero.
       */
      netWorthChangeCents += netWorthCents(total.type, amountCents, 0);
      if (isIncome(total.type)) {
        incomeCents += amountCents;
      }
      expensesCents += expenseCents(total.type, amountCents, 0);

      byType.push({
        type: total.type,
        amount: amountCents / 100,
        transactionCount: total.transactionCount,
      });
    }

    /*
     * La quota non prestata di un movimento di tipo prestito è spesa reale:
     * entra nelle uscite e riduce il patrimonio. La liquidità invece non si
     * muove — il denaro era già uscito tutto, ed è già in `netMovementCents`.
     */
    const ownExpense = ownExpenseCents(loansService.allocations(), inPeriod);
    expensesCents += ownExpense;
    netWorthChangeCents -= ownExpense;

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
      netWorthChange: netWorthChangeCents / 100,
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
