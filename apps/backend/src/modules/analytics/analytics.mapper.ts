import { merchantLabel } from "../merchants/index.js";
import {
  creditCents,
  expenseDistribution,
  toAmountCents,
  type TransactionWithMerchant,
} from "../transactions/index.js";
import {
  type AnalyticsAggregation,
  type FinancialTotals,
} from "./analytics.aggregation.js";
import { buildTimeline } from "./analytics.timeline.js";
import type { AnalyticsQuery } from "./analytics.query.js";
import type {
  AnalyticsCounts,
  AnalyticsOverview,
  AnalyticsViewModel,
  CategoryDistribution,
  LoanEntry,
  LoansSection,
  MerchantDistribution,
} from "./analytics.view-model.js";

function toOverview(totals: FinancialTotals): AnalyticsOverview {
  return {
    income: totals.income / 100,
    expenses: totals.expenses / 100,
    balance: (totals.income - totals.expenses) / 100,
    withdrawals: totals.withdrawals / 100,
    loans: totals.loans / 100,
    transfers: totals.transfers / 100,
    other: totals.other / 100,
    netMovement: totals.netMovement / 100,
  };
}

function toCounts(
  aggregation: AnalyticsAggregation,
  transactionCount: number,
): AnalyticsCounts {
  return {
    transactions: transactionCount,
    merchants: aggregation.merchantIds.size,
    categories: aggregation.categoryIds.size,
  };
}

/*
 * Categorie e merchant seguono la regola delle distribuzioni: solo le voci con
 * spesa netta positiva, quote sulla loro somma. Il totale delle uscite
 * dell'overview resta invece netto.
 */

function toCategoryDistribution(
  aggregation: AnalyticsAggregation,
): CategoryDistribution[] {
  return expenseDistribution(
    [...aggregation.expensesByCategory].map(([categoryId, total]) => ({
      categoryId,
      ...total,
    })),
  ).map((share) => ({
    categoryId: share.categoryId,
    name: share.name,
    color: share.color,
    amount: share.amountCents / 100,
    transactionCount: share.transactionCount,
    percentage: share.percentage,
  }));
}

function toMerchantDistribution(
  aggregation: AnalyticsAggregation,
): MerchantDistribution[] {
  return expenseDistribution(
    [...aggregation.expensesByMerchant].map(([merchantId, total]) => ({
      merchantId,
      ...total,
    })),
  ).map((share) => ({
    merchantId: share.merchantId,
    name: share.name,
    category: share.categoryName,
    amount: share.amountCents / 100,
    transactionCount: share.transactionCount,
    percentage: share.percentage,
  }));
}

function toTimeline(
  firstDate: string | null,
  lastDate: string | null,
  entries: readonly TransactionWithMerchant[],
  query: AnalyticsQuery,
  lentByTransaction: ReadonlyMap<string, number>,
) {
  if (firstDate === null || lastDate === null) {
    return { granularity: query.granularity ?? "month", buckets: [] };
  }

  return buildTimeline(
    entries,
    firstDate,
    lastDate,
    query.granularity,
    lentByTransaction,
  );
}

function buildLoans(
  entries: readonly TransactionWithMerchant[],
  lentByTransaction: ReadonlyMap<string, number>,
): LoansSection {
  let lentCents = 0;
  const items: LoanEntry[] = [];

  for (const { transaction, merchant } of entries) {
    if (transaction.type !== "LOAN") {
      continue;
    }

    const amountCents = toAmountCents(transaction.amount);
    /*
     * Prestato è la quota diventata credito, non l'intero movimento: di un
     * pagamento in parte proprio, la parte propria è una spesa e compare fra
     * le uscite, non qui.
     */
    lentCents += creditCents(
      transaction.type,
      amountCents,
      lentByTransaction.get(transaction.id) ?? 0,
    );

    items.push({
      id: transaction.id,
      bookingDate: transaction.bookingDate,
      description: transaction.description,
      merchant: merchant === null ? null : merchantLabel(merchant.merchant),
      amount: transaction.amount,
    });
  }

  return {
    lent: lentCents / 100,
    transactionCount: items.length,
    entries: items,
  };
}

export function toAnalyticsViewModel(
  query: AnalyticsQuery,
  entries: readonly TransactionWithMerchant[],
  aggregation: AnalyticsAggregation,
  lentByTransaction: ReadonlyMap<string, number>,
): AnalyticsViewModel {
  const { totals, firstDate, lastDate } = aggregation;

  return {
    period: {
      from: query.from,
      to: query.to,
      firstTransactionDate: firstDate,
      lastTransactionDate: lastDate,
    },
    query,
    overview: toOverview(totals),
    counts: toCounts(aggregation, entries.length),
    byCategory: toCategoryDistribution(aggregation),
    byMerchant: toMerchantDistribution(aggregation),
    /*
     * L'andamento va dal primo all'ultimo movimento osservato, non da un
     * estremo all'altro del periodo richiesto: un intervallo che l'archivio
     * non copre non vale "zero speso", e su una spezzata si leggerebbe come
     * un crollo a zero.
     */
    timeline: toTimeline(firstDate, lastDate, entries, query, lentByTransaction),
    loans: buildLoans(entries, lentByTransaction),
  };
}
