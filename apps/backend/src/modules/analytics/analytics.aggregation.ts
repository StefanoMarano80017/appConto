import type { Category } from "../categories/category.model.js";
import { merchantLabel } from "../merchants/index.js";
import {
  creditCents,
  expenseCents,
  hasExpense,
  toAmountCents,
  type TransactionType,
  type TransactionWithMerchant,
} from "../transactions/index.js";

const UNCATEGORIZED_NAME = "Senza categoria";
const UNKNOWN_MERCHANT_NAME = "Senza merchant";

/** Accumulatore in centesimi: le somme restano esatte. */
export interface FinancialTotals {
  income: number;
  expenses: number;
  withdrawals: number;
  loans: number;
  transfers: number;
  other: number;
  netMovement: number;
}

export const emptyFinancialTotals = (): FinancialTotals => ({
  income: 0,
  expenses: 0,
  withdrawals: 0,
  loans: 0,
  transfers: 0,
  other: 0,
  netMovement: 0,
});

export interface CategoryTotal {
  name: string;
  color: string | null;
  amountCents: number;
  transactionCount: number;
}

export interface MerchantTotal {
  name: string;
  categoryName: string | null;
  amountCents: number;
  transactionCount: number;
}

export interface AnalyticsAggregation {
  totals: FinancialTotals;
  merchantIds: Set<string>;
  categoryIds: Set<string>;
  expensesByCategory: Map<string | null, CategoryTotal>;
  expensesByMerchant: Map<string | null, MerchantTotal>;
  firstDate: string | null;
  lastDate: string | null;
}

/**
 * Accumula una transazione nei totali finanziari.
 *
 * Centralizza la relazione tra TransactionType e le voci di FinancialTotals.
 * Per i prestiti separa la quota rimasta a carico proprio dalla quota
 * diventata credito.
 */
export function accumulate(
  totals: FinancialTotals,
  type: TransactionType,
  amountCents: number,
  lentCents: number,
): void {
  totals.netMovement += amountCents;

  switch (type) {
    case "INCOME":
      totals.income += amountCents;
      return;
    case "EXPENSE":
      totals.expenses += expenseCents(type, amountCents, lentCents);
      return;
    case "WITHDRAWAL":
      totals.withdrawals += amountCents;
      return;
    case "LOAN":
      totals.expenses += expenseCents(type, amountCents, lentCents);
      totals.loans -= creditCents(type, amountCents, lentCents);
      return;
    case "TRANSFER":
      totals.transfers += amountCents;
      return;
    case "OTHER":
      totals.other += amountCents;
      return;
  }
}

function emptyAnalyticsAggregation(): AnalyticsAggregation {
  return {
    totals: emptyFinancialTotals(),
    merchantIds: new Set<string>(),
    categoryIds: new Set<string>(),
    expensesByCategory: new Map<string | null, CategoryTotal>(),
    expensesByMerchant: new Map<string | null, MerchantTotal>(),
    firstDate: null,
    lastDate: null,
  };
}

function createCategoryTotal(category: Category | null): CategoryTotal {
  return {
    name: category?.name ?? UNCATEGORIZED_NAME,
    color: category?.color ?? null,
    amountCents: 0,
    transactionCount: 0,
  };
}

function createMerchantTotal(
  merchant: TransactionWithMerchant["merchant"],
  category: Category | null,
): MerchantTotal {
  return {
    name:
      merchant === null
        ? UNKNOWN_MERCHANT_NAME
        : merchantLabel(merchant.merchant),
    categoryName: category?.name ?? null,
    amountCents: 0,
    transactionCount: 0,
  };
}

function accumulateExpense(
  aggregation: AnalyticsAggregation,
  entry: TransactionWithMerchant,
  expenseCentsAmount: number,
): void {
  const { transaction, merchant } = entry;
  const category = merchant?.category ?? null;
  const categoryKey = category?.id ?? null;
  const merchantKey = transaction.merchantId;
  
  const categoryTotal =
    aggregation.expensesByCategory.get(categoryKey) ??
    createCategoryTotal(category);

  categoryTotal.amountCents += expenseCentsAmount;
  categoryTotal.transactionCount += 1;
  aggregation.expensesByCategory.set(categoryKey, categoryTotal);

  
  const merchantTotal =
    aggregation.expensesByMerchant.get(merchantKey) ??
    createMerchantTotal(merchant, category);
  merchantTotal.amountCents += expenseCentsAmount;
  merchantTotal.transactionCount += 1;
  aggregation.expensesByMerchant.set(merchantKey, merchantTotal);
}

export function aggregateEntries(
  entries: readonly TransactionWithMerchant[],
  lentByTransaction: ReadonlyMap<string, number>,
): AnalyticsAggregation {
  const aggregation = emptyAnalyticsAggregation();

  for (const entry of entries) {
    const { transaction, merchant } = entry;
    const amountCents = toAmountCents(transaction.amount);
    const lentCents = lentByTransaction.get(transaction.id) ?? 0;

    accumulate(aggregation.totals, transaction.type, amountCents, lentCents);
    updateDateRange(aggregation, transaction.bookingDate);

    if (transaction.merchantId !== null) {
      aggregation.merchantIds.add(transaction.merchantId);
    }

    if (merchant?.category !== null && merchant?.category !== undefined) {
      aggregation.categoryIds.add(merchant.category.id);
    }

    if (hasExpense(transaction.type, amountCents, lentCents)) {
      accumulateExpense(
        aggregation,
        entry,
        expenseCents(transaction.type, amountCents, lentCents),
      );
    }
  }

  return aggregation;
}

function updateDateRange(
  aggregation: AnalyticsAggregation,
  bookingDate: string,
): void {
  if (aggregation.firstDate === null || bookingDate < aggregation.firstDate) {
    aggregation.firstDate = bookingDate;
  }

  if (aggregation.lastDate === null || bookingDate > aggregation.lastDate) {
    aggregation.lastDate = bookingDate;
  }
}
