import { DEFAULT_LOAN_QUERY, loansService } from '../loans/index.js';
import { DEFAULT_MERCHANT_QUERY, merchantLabel, merchantsService } from '../merchants/index.js';
import { requireMonth, summarizeEntries } from '../summary/index.js';
import {
  DEFAULT_QUERY,
  expenseCents,
  hasExpense,
  toAmountCents,
  transactionsService,
  type TransactionWithMerchant,
} from '../transactions/index.js';
import { clampMonth, comparisonWindow, defaultMonth, previousMonth } from './dashboard.period.js';
import type {
  DashboardCategory,
  DashboardViewModel,
  RecentTransaction,
} from './dashboard.view-model.js';

const TOP_CATEGORIES_LIMIT = 5;
const RECENT_TRANSACTIONS_LIMIT = 5;

const UNCATEGORIZED_NAME = 'Senza categoria';

/** Un movimento e la quota che ne è spesa reale. */
interface ExpenseEntry extends TransactionWithMerchant {
  /** Centesimi positivi. Di un pagamento in parte prestato è la parte propria. */
  expense: number;
}

interface CategoryTotal {
  name: string;
  color: string | null;
  amountCents: number;
}

/**
 * I soli movimenti che contengono una spesa, con la quota che lo è.
 *
 * Prelievi e giroconti non sono spesa e restano fuori. Un pagamento in parte
 * prestato entra per la sola quota rimasta a carico proprio.
 */
function expensesOnly(
  entries: readonly TransactionWithMerchant[],
  lentByTransaction: ReadonlyMap<string, number>,
): ExpenseEntry[] {
  return entries.flatMap((entry) => {
    const amountCents = toAmountCents(entry.transaction.amount);
    const lentCents = lentByTransaction.get(entry.transaction.id) ?? 0;

    if (!hasExpense(entry.transaction.type, amountCents, lentCents)) {
      return [];
    }

    return [{ ...entry, expense: expenseCents(entry.transaction.type, amountCents, lentCents) }];
  });
}

/** Spese per categoria, in centesimi. */
function expenseCentsByCategory(
  entries: readonly ExpenseEntry[],
): Map<string | null, CategoryTotal> {
  const totals = new Map<string | null, CategoryTotal>();

  for (const { merchant, expense } of entries) {
    const category = merchant?.category ?? null;
    const key = category?.id ?? null;
    const total = totals.get(key) ?? {
      name: category?.name ?? UNCATEGORIZED_NAME,
      color: category?.color ?? null,
      amountCents: 0,
    };

    total.amountCents += expense;
    totals.set(key, total);
  }

  return totals;
}

const sumCents = (totals: Iterable<CategoryTotal>): number =>
  [...totals].reduce((sum, total) => sum + total.amountCents, 0);

/** Restringe ai movimenti con data contabile nell'intervallo (estremi inclusi, `null` = aperto). */
const withinDates = (entries: readonly ExpenseEntry[], from: string | null, to: string | null) =>
  entries.filter(
    ({ transaction }) =>
      (from === null || transaction.bookingDate >= from) &&
      (to === null || transaction.bookingDate <= to),
  );

/** Una frazione espressa in percentuale, con un decimale. */
const percentOf = (fraction: number): number => Math.round(fraction * 1000) / 10;

function toRecentTransaction({ transaction, merchant }: TransactionWithMerchant): RecentTransaction {
  const category = merchant?.category ?? null;

  return {
    id: transaction.id,
    bookingDate: transaction.bookingDate,
    label: merchant === null ? transaction.description : merchantLabel(merchant.merchant),
    type: transaction.type,
    category:
      category === null ? null : { id: category.id, name: category.name, color: category.color },
    amount: transaction.amount,
  };
}

/**
 * Caso d'uso "dashboard".
 *
 * Non possiede dati propri e non conosce SQLite: compone i servizi pubblici di
 * `transactions`, `merchants`, `summary` e `loans`. Tutte le sezioni derivano
 * dallo stesso insieme di movimenti e dalla stessa ripartizione fra spesa e
 * credito, quindi non possono raccontare cose diverse.
 */
export const dashboardService = {
  /** `month` assente: il mese dell'ultimo movimento. `today` è la data locale (`YYYY-MM-DD`). */
  getDashboard(month: string | undefined, today: string): DashboardViewModel {
    const latest = transactionsService.search(DEFAULT_QUERY).transactions;
    const lastTransactionDate = latest[0]?.transaction.bookingDate ?? null;

    const validMonth =
      month === undefined
        ? defaultMonth(lastTransactionDate, today)
        : clampMonth(requireMonth(month), today);
    const window = comparisonWindow(validMonth, today);

    // Una sola lettura dei prestiti per tutta la risposta.
    const lentByTransaction = loansService.lentCentsByTransaction();
    const entries = transactionsService.listByMonthWithMerchant(validMonth);
    const expenses = expensesOnly(entries, lentByTransaction);

    const summary = summarizeEntries(validMonth, entries, lentByTransaction);
    const withdrawalsCents = entries
      .filter(({ transaction }) => transaction.type === 'WITHDRAWAL')
      .reduce((sum, { transaction }) => sum + Math.abs(toAmountCents(transaction.amount)), 0);

    // Confronto: la finestra corrente può fermarsi a oggi, quella precedente è sempre delimitata.
    const currentCategories = expenseCentsByCategory(withinDates(expenses, null, window.currentTo));
    const previousCategories = expenseCentsByCategory(
      withinDates(
        expensesOnly(
          transactionsService.listByMonthWithMerchant(previousMonth(validMonth)),
          lentByTransaction,
        ),
        window.previousFrom,
        window.previousTo,
      ),
    );
    const currentCents = sumCents(currentCategories.values());
    const previousCents = sumCents(previousCategories.values());

    // Importo e percentuale riguardano il mese intero; la variazione, la finestra di confronto.
    const topCategories = [...expenseCentsByCategory(expenses).entries()]
      .map(
        ([id, total]): DashboardCategory => ({
          id,
          name: total.name,
          color: total.color,
          amount: total.amountCents / 100,
          percentage:
            summary.expenses > 0 ? percentOf(total.amountCents / 100 / summary.expenses) : null,
          difference:
            ((currentCategories.get(id)?.amountCents ?? 0) -
              (previousCategories.get(id)?.amountCents ?? 0)) /
            100,
        }),
      )
      .sort((a, b) => b.amount - a.amount)
      .slice(0, TOP_CATEGORIES_LIMIT);

    // Movimenti LOAN dell'archivio per cui non è registrato alcun prestito.
    const linkedLoanTransactions = new Set(
      loansService
        .allocations()
        .filter((allocation) => allocation.type === 'LOAN')
        .map((allocation) => allocation.transactionId),
    );
    const loanTransactions = transactionsService.search({
      ...DEFAULT_QUERY,
      types: ['LOAN'],
      pageSize: 25,
    }).total;
    const { totals } = loansService.list(DEFAULT_LOAN_QUERY);

    return {
      month: validMonth,
      today,
      lastTransactionDate,
      summary: {
        income: summary.income,
        expenses: summary.expenses,
        balance: summary.balance,
        withdrawals: withdrawalsCents / 100,
      },
      comparison: {
        previousExpenses: previousCents / 100,
        percentChange:
          previousCents === 0 ? null : percentOf((currentCents - previousCents) / previousCents),
        ...window,
      },
      topCategories,
      recentTransactions: latest.slice(0, RECENT_TRANSACTIONS_LIMIT).map(toRecentTransaction),
      attention: {
        unclassifiedMerchants: merchantsService.search(DEFAULT_MERCHANT_QUERY).counts.unclassified,
      },
      loans: {
        remaining: totals.remaining,
        openCount: totals.openCount,
        unlinkedTransactions: Math.max(loanTransactions - linkedLoanTransactions.size, 0),
      },
    };
  },
};
