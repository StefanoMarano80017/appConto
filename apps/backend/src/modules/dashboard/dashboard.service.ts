import { cashFlowService } from '../cash-flow/index.js';
import { loansService } from '../loans/index.js';
import { merchantLabel } from '../merchants/index.js';
import { requireMonth, summarizeEntries } from '../summary/index.js';
import {
  expenseCents,
  hasExpense,
  toAmountCents,
  toTransactionDto,
  transactionsService,
  type TransactionWithMerchant,
} from '../transactions/index.js';
import { applyFilters, type DashboardFilters } from './dashboard-filters.js';
import type {
  CategoryBreakdown,
  CategoryComparison,
  DashboardViewModel,
  MerchantBreakdown,
  MonthComparison,
  TopMerchant,
  TransactionRef,
} from './dashboard.view-model.js';

/** Quanti merchant mostrare nella sezione "top": l'elenco completo vive in `/merchants`. */
const TOP_MERCHANTS_LIMIT = 5;

const UNCATEGORIZED_NAME = 'Senza categoria';
const UNKNOWN_MERCHANT_NAME = 'Senza merchant';

interface MerchantAccumulator {
  id: string;
  label: string;
  amountCents: number;
  transactions: TransactionRef[];
}

interface CategoryAccumulator {
  id: string | null;
  name: string;
  color: string | null;
  amountCents: number;
  transactionCount: number;
  merchants: Map<string, MerchantAccumulator>;
}

/** Il mese precedente a `YYYY-MM`. */
export function previousMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];

  return monthNumber === 1
    ? `${year - 1}-12`
    : `${year}-${String(monthNumber - 1).padStart(2, '0')}`;
}

/** Un movimento e la quota che ne è spesa reale. */
interface ExpenseEntry extends TransactionWithMerchant {
  /** Centesimi positivi. Di un pagamento in parte prestato è la parte propria. */
  expense: number;
}

/**
 * I soli movimenti che contengono una spesa, con la quota che lo è.
 *
 * Prelievi e giroconti non sono spesa e restano fuori. Un pagamento in parte
 * prestato entra per la sola quota rimasta a carico proprio: è quella che è
 * finita davvero in una categoria. Calcolare la quota una volta qui evita che
 * ogni sezione della dashboard la ricavi a modo suo.
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

/** Spese per categoria, in centesimi: base sia del drill down sia del confronto. */
function expenseCentsByCategory(entries: readonly ExpenseEntry[]): Map<
  string | null,
  { name: string; color: string | null; amountCents: number }
> {
  const totals = new Map<string | null, { name: string; color: string | null; amountCents: number }>();

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

/** Gerarchia categoria -> merchant -> transazioni, costruita dai soli dati esistenti. */
function buildCategoryBreakdown(entries: readonly ExpenseEntry[]): CategoryBreakdown[] {
  const categories = new Map<string | null, CategoryAccumulator>();

  for (const { transaction, merchant, expense: amountCents } of entries) {
    const category = merchant?.category ?? null;
    const categoryKey = category?.id ?? null;

    const accumulator = categories.get(categoryKey) ?? {
      id: categoryKey,
      name: category?.name ?? UNCATEGORIZED_NAME,
      color: category?.color ?? null,
      amountCents: 0,
      transactionCount: 0,
      merchants: new Map<string, MerchantAccumulator>(),
    };
    accumulator.amountCents += amountCents;
    accumulator.transactionCount += 1;

    const merchantKey = transaction.merchantId ?? '';
    const merchantAccumulator = accumulator.merchants.get(merchantKey) ?? {
      id: merchantKey,
      label: merchant === null ? UNKNOWN_MERCHANT_NAME : merchantLabel(merchant.merchant),
      amountCents: 0,
      transactions: [],
    };
    merchantAccumulator.amountCents += amountCents;
    merchantAccumulator.transactions.push({
      id: transaction.id,
      bookingDate: transaction.bookingDate,
      description: transaction.description,
      amount: amountCents / 100,
    });

    accumulator.merchants.set(merchantKey, merchantAccumulator);
    categories.set(categoryKey, accumulator);
  }

  return [...categories.values()]
    .map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      amount: category.amountCents / 100,
      transactionCount: category.transactionCount,
      merchants: [...category.merchants.values()]
        .map(
          (merchant): MerchantBreakdown => ({
            id: merchant.id,
            label: merchant.label,
            amount: merchant.amountCents / 100,
            transactionCount: merchant.transactions.length,
            transactions: [...merchant.transactions].sort((a, b) =>
              b.bookingDate.localeCompare(a.bookingDate),
            ),
          }),
        )
        .sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function buildTopMerchants(entries: readonly ExpenseEntry[]): TopMerchant[] {
  const totals = new Map<string, TopMerchant & { amountCents: number }>();

  for (const { merchant, expense } of entries) {
    if (merchant === null) {
      continue;
    }

    const total = totals.get(merchant.merchant.id) ?? {
      id: merchant.merchant.id,
      label: merchantLabel(merchant.merchant),
      amount: 0,
      amountCents: 0,
      transactionCount: 0,
      categoryName: merchant.category?.name ?? null,
    };
    total.amountCents += expense;
    total.transactionCount += 1;
    totals.set(merchant.merchant.id, total);
  }

  return [...totals.values()]
    .map(({ amountCents, ...merchant }) => ({ ...merchant, amount: amountCents / 100 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, TOP_MERCHANTS_LIMIT);
}

function buildComparison(
  month: string,
  current: readonly ExpenseEntry[],
  previous: readonly ExpenseEntry[],
): MonthComparison {
  const currentByCategory = expenseCentsByCategory(current);
  const previousByCategory = expenseCentsByCategory(previous);

  const currentCents = [...currentByCategory.values()].reduce((s, c) => s + c.amountCents, 0);
  const previousCents = [...previousByCategory.values()].reduce((s, c) => s + c.amountCents, 0);

  const keys = new Set([...currentByCategory.keys(), ...previousByCategory.keys()]);
  const byCategory: CategoryComparison[] = [...keys]
    .map((key) => {
      const now = currentByCategory.get(key);
      const before = previousByCategory.get(key);
      const reference = now ?? before;

      return {
        id: key,
        name: reference?.name ?? UNCATEGORIZED_NAME,
        color: reference?.color ?? null,
        current: (now?.amountCents ?? 0) / 100,
        previous: (before?.amountCents ?? 0) / 100,
        difference: ((now?.amountCents ?? 0) - (before?.amountCents ?? 0)) / 100,
      };
    })
    // Prima le variazioni più marcate, in aumento o in diminuzione.
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  return {
    previousMonth: previousMonth(month),
    currentExpenses: currentCents / 100,
    previousExpenses: previousCents / 100,
    difference: (currentCents - previousCents) / 100,
    percentChange:
      previousCents === 0
        ? null
        : Math.round(((currentCents - previousCents) / previousCents) * 1000) / 10,
    byCategory,
  };
}

/**
 * Caso d'uso "dashboard".
 *
 * Non possiede dati propri e non conosce SQLite: compone i servizi pubblici di
 * `transactions`, `merchants` (tramite le transazioni arricchite), `summary`,
 * `cash-flow` e `loans`. Tutte le sezioni derivano dallo stesso insieme
 * filtrato e dalla stessa ripartizione fra spesa e credito, quindi non possono
 * raccontare cose diverse.
 */
export const dashboardService = {
  getDashboard(month: string, filters: DashboardFilters): DashboardViewModel {
    const validMonth = requireMonth(month);

    const entries = applyFilters(
      transactionsService.listByMonthWithMerchant(validMonth),
      filters,
    );
    const previousEntries = applyFilters(
      transactionsService.listByMonthWithMerchant(previousMonth(validMonth)),
      filters,
    );

    // Una sola lettura dei prestiti per tutta la risposta.
    const lentByTransaction = loansService.lentCentsByTransaction();
    const expenses = expensesOnly(entries, lentByTransaction);

    return {
      month: validMonth,
      filters,
      summary: summarizeEntries(validMonth, entries, lentByTransaction),
      cashFlow: cashFlowService.getCashFlow(validMonth),
      categories: buildCategoryBreakdown(expenses),
      topMerchants: buildTopMerchants(expenses),
      comparison: buildComparison(
        validMonth,
        expenses,
        expensesOnly(previousEntries, lentByTransaction),
      ),
      transactions: entries.map(toTransactionDto),
    };
  },
};
