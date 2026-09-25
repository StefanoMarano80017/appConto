import { merchantLabel } from "../merchants/index.js";
import {
  creditCents,
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

/** Quota sul totale delle spese, con un decimale. Senza spese non c'è quota. */
function percentageOf(amountCents: number, expensesCents: number): number {
  return expensesCents === 0
    ? 0
    : Math.round((amountCents / expensesCents) * 1000) / 10;
}

/** Le voci di una distribuzione, dalla più consistente. */
function byAmountDescending<T extends { amountCents: number }>(
  totals: Map<string | null, T>,
): [string | null, T][] {
  return [...totals.entries()].sort(
    ([, a], [, b]) => b.amountCents - a.amountCents,
  );
}

function toCategoryDistribution(
  aggregation: AnalyticsAggregation,
): CategoryDistribution[] {
  return byAmountDescending(aggregation.expensesByCategory).map(
    ([categoryId, total]) => ({
      categoryId,
      name: total.name,
      color: total.color,
      amount: total.amountCents / 100,
      transactionCount: total.transactionCount,
      percentage: percentageOf(total.amountCents, aggregation.totals.expenses),
    }),
  );
}

function toMerchantDistribution(
  aggregation: AnalyticsAggregation,
): MerchantDistribution[] {
  return byAmountDescending(aggregation.expensesByMerchant).map(
    ([merchantId, total]) => ({
      merchantId,
      name: total.name,
      category: total.categoryName,
      amount: total.amountCents / 100,
      transactionCount: total.transactionCount,
      percentage: percentageOf(total.amountCents, aggregation.totals.expenses),
    }),
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
    timeline:
      firstDate === null || lastDate === null
        ? { granularity: query.granularity ?? "month", buckets: [] }
        : buildTimeline(
            entries,
            firstDate,
            lastDate,
            query.granularity,
            lentByTransaction,
          ),
    loans: buildLoans(entries, lentByTransaction),
  };
}
