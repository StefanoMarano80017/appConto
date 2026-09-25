import {
  accumulate,
  emptyFinancialTotals,
  type FinancialTotals,
} from "./analytics.aggregation.js";
import type { TransactionWithMerchant } from "../transactions/index.js";
import { toAmountCents } from "../transactions/index.js";
import type {
  Timeline,
  TimelineBucket,
  TimelineGranularity,
} from "./analytics.view-model.js";

/** Fino a 31 giorni la timeline usa una granularità giornaliera. */
const DAILY_GRANULARITY_MAX_DAYS = 31;

/** Fino a 186 giorni la timeline usa una granularità settimanale. */
const WEEKLY_GRANULARITY_MAX_DAYS = 186;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function addDays(date: string, days: number): string {
  const next =
    new Date(`${date}T00:00:00Z`).getTime() + days * MILLISECONDS_PER_DAY;
  return new Date(next).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const span =
    new Date(`${to}T00:00:00Z`).getTime() -
    new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(span / MILLISECONDS_PER_DAY);
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];

  return monthNumber === 12
    ? `${year + 1}-01`
    : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
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
  if (granularity === "day") {
    return date;
  }

  return granularity === "week" ? startOfWeek(date) : date.slice(0, 7);
}

/** Primo e ultimo giorno coperti da un intervallo. */
function boundsOf(
  period: string,
  granularity: TimelineGranularity,
): [string, string] {
  if (granularity === "day") {
    return [period, period];
  }

  return granularity === "week"
    ? [period, addDays(period, 6)]
    : [`${period}-01`, lastDayOfMonth(period)];
}

/** L'intervallo successivo, con il passo indicato. */
function advance(period: string, granularity: TimelineGranularity): string {
  if (granularity === "day") {
    return addDays(period, 1);
  }

  return granularity === "week" ? addDays(period, 7) : nextMonth(period);
}

/**
 * Gli intervalli consecutivi che coprono il periodo, anche quelli vuoti: un
 * mese senza spese è un'informazione, non un buco da nascondere.
 */
function periodsBetween(
  from: string,
  to: string,
  granularity: TimelineGranularity,
): string[] {
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

/** Determina automaticamente la granularità in base all'ampiezza del periodo. */
export function automaticGranularity(
  from: string,
  to: string,
): TimelineGranularity {
  const days = daysBetween(from, to);
  if (days <= DAILY_GRANULARITY_MAX_DAYS) {
    return "day";
  }

  return days <= WEEKLY_GRANULARITY_MAX_DAYS ? "week" : "month";
}

/** Mantiene anche i periodi senza transazioni, utili per leggere l'andamento. */
function createPeriodTotals(
  from: string,
  to: string,
  granularity: TimelineGranularity,
): Map<string, FinancialTotals> {
  return new Map(
    periodsBetween(from, to, granularity).map((period) => [
      period,
      emptyFinancialTotals(),
    ]),
  );
}

function toTimelineBucket(
  period: string,
  totals: FinancialTotals,
  granularity: TimelineGranularity,
  from: string,
  to: string,
): TimelineBucket {
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
}

export function buildTimeline(
  entries: readonly TransactionWithMerchant[],
  from: string,
  to: string,
  requested: TimelineGranularity | null,
  lentByTransaction: ReadonlyMap<string, number>,
): Timeline {
  const granularity = requested ?? automaticGranularity(from, to);

  const totalsByPeriod = createPeriodTotals(from, to, granularity);

  for (const { transaction } of entries) {
    const period = periodOf(transaction.bookingDate, granularity);
    const totals = totalsByPeriod.get(period);

    if (!totals) {
      continue;
    }

    accumulate(
      totals,
      transaction.type,
      toAmountCents(transaction.amount),
      lentByTransaction.get(transaction.id) ?? 0,
    );
  }

  const buckets: TimelineBucket[] = [...totalsByPeriod.entries()].map(
    ([period, totals]) =>
      toTimelineBucket(period, totals, granularity, from, to),
  );

  return { granularity, buckets };
}
