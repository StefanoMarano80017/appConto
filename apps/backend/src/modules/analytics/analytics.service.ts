import { loansService } from '../loans/index.js';
import { merchantLabel } from '../merchants/index.js';
import {
  creditCents,
  expenseCents,
  hasExpense,
  isIncome,
  toAmountCents,
  transactionsService,
  type TransactionType,
  type TransactionWithMerchant,
} from '../transactions/index.js';
import { selectEntries, type AnalyticsQuery } from './analytics.query.js';
import type {
  AnalyticsCounts,
  AnalyticsOverview,
  AnalyticsViewModel,
  CategoryDistribution,
  LoanEntry,
  LoansSection,
  MerchantDistribution,
  Timeline,
  TimelineBucket,
  TimelineGranularity,
} from './analytics.view-model.js';

/** Oltre un mese il giorno per giorno diventa illeggibile: si passa alle settimane. */
const DAILY_GRANULARITY_MAX_DAYS = 31;

/** Oltre una mezza dozzina di mesi anche le settimane sono troppe: si passa ai mesi. */
const WEEKLY_GRANULARITY_MAX_DAYS = 186;

const UNCATEGORIZED_NAME = 'Senza categoria';
const UNKNOWN_MERCHANT_NAME = 'Senza merchant';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Accumulatore in centesimi: le somme restano esatte. */
interface CentsByType {
  income: number;
  expenses: number;
  withdrawals: number;
  loans: number;
  transfers: number;
  other: number;
  netMovement: number;
}

const emptyCents = (): CentsByType => ({
  income: 0,
  expenses: 0,
  withdrawals: 0,
  loans: 0,
  transfers: 0,
  other: 0,
  netMovement: 0,
});

/**
 * Unica traduzione fra tipo e voce del totale.
 *
 * La semantica di "spesa" e "entrata" resta quella del dominio: qui si decide
 * soltanto in quale casella finisce ciascun tipo.
 *
 * Un movimento di tipo prestito può finire in due caselle: `loans` accoglie la
 * quota diventata credito, `expenses` quella rimasta a carico proprio. La somma
 * delle caselle continua a valere `netMovement`.
 */
function accumulate(
  totals: CentsByType,
  type: TransactionType,
  amountCents: number,
  lentCents: number,
): void {
  totals.netMovement += amountCents;

  if (isIncome(type)) {
    totals.income += amountCents;
    return;
  }
  if (type === 'EXPENSE') {
    totals.expenses += expenseCents(type, amountCents, lentCents);
    return;
  }

  if (type === 'WITHDRAWAL') {
    totals.withdrawals += amountCents;
  } else if (type === 'LOAN') {
    totals.expenses += expenseCents(type, amountCents, lentCents);
    totals.loans += -creditCents(type, amountCents, lentCents);
  } else if (type === 'TRANSFER') {
    totals.transfers += amountCents;
  } else {
    totals.other += amountCents;
  }
}

function toOverview(totals: CentsByType): AnalyticsOverview {
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

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`).getTime() + days * MILLISECONDS_PER_DAY;
  return new Date(next).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const span = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(span / MILLISECONDS_PER_DAY);
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];

  return monthNumber === 12
    ? `${year + 1}-01`
    : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
}

const lastDayOfMonth = (month: string): string =>
  addDays(`${nextMonth(month)}-01`, -1);

/** Il lunedì della settimana in cui cade la data. */
export function startOfWeek(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();

  // getUTCDay() mette la domenica a 0: la settimana comincia il lunedì.
  return addDays(date, -((weekday + 6) % 7));
}

/** L'intervallo a cui una data appartiene, con il passo indicato. */
function periodOf(date: string, granularity: TimelineGranularity): string {
  if (granularity === 'day') {
    return date;
  }

  return granularity === 'week' ? startOfWeek(date) : date.slice(0, 7);
}

/** Primo e ultimo giorno coperti da un intervallo. */
function boundsOf(period: string, granularity: TimelineGranularity): [string, string] {
  if (granularity === 'day') {
    return [period, period];
  }

  return granularity === 'week'
    ? [period, addDays(period, 6)]
    : [`${period}-01`, lastDayOfMonth(period)];
}

/** L'intervallo successivo, con il passo indicato. */
function advance(period: string, granularity: TimelineGranularity): string {
  if (granularity === 'day') {
    return addDays(period, 1);
  }

  return granularity === 'week' ? addDays(period, 7) : nextMonth(period);
}

/**
 * Gli intervalli consecutivi che coprono il periodo, anche quelli vuoti: un
 * mese senza spese è un'informazione, non un buco da nascondere.
 */
function periodsBetween(from: string, to: string, granularity: TimelineGranularity): string[] {
  const periods: string[] = [];
  const last = periodOf(to, granularity);

  for (
    let period = periodOf(from, granularity);
    period <= last;
    period = advance(period, granularity)
  ) {
    periods.push(period);
  }

  return periods;
}

/** Il passo che rende leggibile un periodo di quella ampiezza. */
export function automaticGranularity(from: string, to: string): TimelineGranularity {
  const days = daysBetween(from, to);
  if (days <= DAILY_GRANULARITY_MAX_DAYS) {
    return 'day';
  }

  return days <= WEEKLY_GRANULARITY_MAX_DAYS ? 'week' : 'month';
}

function buildTimeline(
  entries: readonly TransactionWithMerchant[],
  from: string,
  to: string,
  requested: TimelineGranularity | null,
  lentByTransaction: ReadonlyMap<string, number>,
): Timeline {
  const granularity = requested ?? automaticGranularity(from, to);

  const totalsByPeriod = new Map<string, CentsByType>(
    periodsBetween(from, to, granularity).map((period) => [period, emptyCents()]),
  );

  for (const { transaction } of entries) {
    const key = periodOf(transaction.bookingDate, granularity);

    // Un movimento fuori dagli estremi non può esistere: la lettura li ha già applicati.
    const totals = totalsByPeriod.get(key) ?? emptyCents();
    accumulate(
      totals,
      transaction.type,
      toAmountCents(transaction.amount),
      lentByTransaction.get(transaction.id) ?? 0,
    );
    totalsByPeriod.set(key, totals);
  }

  const buckets: TimelineBucket[] = [...totalsByPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, totals]) => {
      const [start, end] = boundsOf(period, granularity);

      return {
        period,
        partial: start < from || end > to,
        income: totals.income / 100,
        expenses: totals.expenses / 100,
        withdrawals: totals.withdrawals / 100,
        loans: totals.loans / 100,
        transfers: totals.transfers / 100,
        netMovement: totals.netMovement / 100,
      };
    });

  return { granularity, buckets };
}

interface CategoryTotal {
  name: string;
  color: string | null;
  amountCents: number;
  transactionCount: number;
}

interface MerchantTotal {
  name: string;
  categoryName: string | null;
  amountCents: number;
  transactionCount: number;
}

/** Quota sul totale delle spese, con un decimale. Senza spese non c'è quota. */
function percentageOf(amountCents: number, expensesCents: number): number {
  return expensesCents === 0 ? 0 : Math.round((amountCents / expensesCents) * 1000) / 10;
}

/** Le voci di una distribuzione, dalla più consistente. */
function byAmountDescending<T extends { amountCents: number }>(
  totals: Map<string | null, T>,
): [string | null, T][] {
  return [...totals.entries()].sort(([, a], [, b]) => b.amountCents - a.amountCents);
}

function buildLoans(
  entries: readonly TransactionWithMerchant[],
  lentByTransaction: ReadonlyMap<string, number>,
): LoansSection {
  let lentCents = 0;
  const items: LoanEntry[] = [];

  for (const { transaction, merchant } of entries) {
    if (transaction.type !== 'LOAN') {
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

  return { lent: lentCents / 100, transactionCount: items.length, entries: items };
}

/**
 * Caso d'uso "analisi di un periodo".
 *
 * Non possiede dati propri e non conosce SQLite: chiede alla feature
 * `transactions` le transazioni del periodo — già arricchite con merchant e
 * categoria — e le aggrega in una sola passata. Ogni sezione della risposta
 * deriva dallo stesso insieme selezionato, quindi non possono divergere.
 */
export const analyticsService = {
  getAnalytics(query: AnalyticsQuery): AnalyticsViewModel {
    const entries = selectEntries(
      transactionsService.listBetweenWithMerchant(query.from, query.to),
      query,
    );

    /*
     * Quanto di ciascun movimento è stato attribuito a prestiti: serve a
     * ripartire un pagamento fra spesa propria e credito. Analytics resta una
     * proiezione delle transazioni — non mostra prestiti né residui — ma per
     * dire quanto è stato speso deve sapere quanto non lo è stato.
     */
    const lentByTransaction = loansService.lentCentsByTransaction();

    const totals = emptyCents();
    const merchantIds = new Set<string>();
    const categoryIds = new Set<string>();
    const expensesByCategory = new Map<string | null, CategoryTotal>();
    const expensesByMerchant = new Map<string | null, MerchantTotal>();

    let firstDate: string | null = null;
    let lastDate: string | null = null;

    for (const { transaction, merchant } of entries) {
      const amountCents = toAmountCents(transaction.amount);
      const lentCents = lentByTransaction.get(transaction.id) ?? 0;
      accumulate(totals, transaction.type, amountCents, lentCents);

      if (firstDate === null || transaction.bookingDate < firstDate) {
        firstDate = transaction.bookingDate;
      }
      if (lastDate === null || transaction.bookingDate > lastDate) {
        lastDate = transaction.bookingDate;
      }

      if (transaction.merchantId !== null) {
        merchantIds.add(transaction.merchantId);
      }
      const category = merchant?.category ?? null;
      if (category !== null) {
        categoryIds.add(category.id);
      }

      /*
       * Le distribuzioni rispondono a "dove finiscono i soldi": solo le spese.
       * Di un pagamento in parte prestato entra la quota rimasta a carico
       * proprio — quella è finita davvero in questa categoria.
       */
      if (!hasExpense(transaction.type, amountCents, lentCents)) {
        continue;
      }
      const expense = expenseCents(transaction.type, amountCents, lentCents);

      const categoryKey = category?.id ?? null;
      const categoryTotal = expensesByCategory.get(categoryKey) ?? {
        name: category?.name ?? UNCATEGORIZED_NAME,
        color: category?.color ?? null,
        amountCents: 0,
        transactionCount: 0,
      };
      categoryTotal.amountCents += expense;
      categoryTotal.transactionCount += 1;
      expensesByCategory.set(categoryKey, categoryTotal);

      const merchantKey = transaction.merchantId;
      const merchantTotal = expensesByMerchant.get(merchantKey) ?? {
        name: merchant === null ? UNKNOWN_MERCHANT_NAME : merchantLabel(merchant.merchant),
        categoryName: category?.name ?? null,
        amountCents: 0,
        transactionCount: 0,
      };
      merchantTotal.amountCents += expense;
      merchantTotal.transactionCount += 1;
      expensesByMerchant.set(merchantKey, merchantTotal);
    }

    const counts: AnalyticsCounts = {
      transactions: entries.length,
      merchants: merchantIds.size,
      categories: categoryIds.size,
    };

    const byCategory: CategoryDistribution[] = byAmountDescending(expensesByCategory).map(
      ([categoryId, total]) => ({
        categoryId,
        name: total.name,
        color: total.color,
        amount: total.amountCents / 100,
        transactionCount: total.transactionCount,
        percentage: percentageOf(total.amountCents, totals.expenses),
      }),
    );

    const byMerchant: MerchantDistribution[] = byAmountDescending(expensesByMerchant).map(
      ([merchantId, total]) => ({
        merchantId,
        name: total.name,
        category: total.categoryName,
        amount: total.amountCents / 100,
        transactionCount: total.transactionCount,
        percentage: percentageOf(total.amountCents, totals.expenses),
      }),
    );

    return {
      period: {
        from: query.from,
        to: query.to,
        firstTransactionDate: firstDate,
        lastTransactionDate: lastDate,
      },
      query,
      overview: toOverview(totals),
      counts,
      byCategory,
      byMerchant,
      /*
       * L'andamento va dal primo all'ultimo movimento osservato, non da un
       * estremo all'altro del periodo richiesto: un intervallo che l'archivio
       * non copre non vale "zero speso", e su una spezzata si leggerebbe come
       * un crollo a zero.
       */
      timeline:
        firstDate === null || lastDate === null
          ? { granularity: query.granularity ?? 'month', buckets: [] }
          : buildTimeline(entries, firstDate, lastDate, query.granularity, lentByTransaction),
      loans: buildLoans(entries, lentByTransaction),
    };
  },
};
