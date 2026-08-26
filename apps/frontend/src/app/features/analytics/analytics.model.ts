import { ClassificationFilter } from '../transactions/transaction-query';
import { TransactionType } from '../transactions/transaction-type';

/** Lo stato di classificazione è una proprietà della transazione, non dell'analisi. */
export type { ClassificationFilter };

/** Criteri di selezione dell'analisi, così come li interpreta il backend. */
export interface AnalyticsQuery {
  from: string | null;
  to: string | null;
  types: TransactionType[];
  categoryIds: string[];
  merchantIds: string[];
  classification: ClassificationFilter;
  granularity: TimelineGranularity | null;
}

/** Il passo dell'andamento nel tempo. La settimana comincia il lunedì. */
export type TimelineGranularity = 'day' | 'week' | 'month';

export interface AnalyticsPeriod {
  from: string | null;
  to: string | null;
  firstTransactionDate: string | null;
  lastTransactionDate: string | null;
}

/**
 * `income` ed `expenses` sono magnitudini positive; gli altri tipi conservano
 * il segno, perché possono muovere denaro in entrambe le direzioni.
 */
export interface AnalyticsOverview {
  income: number;
  expenses: number;
  balance: number;
  withdrawals: number;
  loans: number;
  transfers: number;
  other: number;
  netMovement: number;
}

export interface AnalyticsCounts {
  transactions: number;
  merchants: number;
  categories: number;
}

export interface CategoryDistribution {
  /** `null` per le spese di merchant non ancora classificati. */
  categoryId: string | null;
  name: string;
  color: string | null;
  amount: number;
  transactionCount: number;
  percentage: number;
}

export interface MerchantDistribution {
  merchantId: string | null;
  name: string;
  category: string | null;
  amount: number;
  transactionCount: number;
  percentage: number;
}

export interface TimelineBucket {
  /**
   * `YYYY-MM-DD` con passo giornaliero, il lunedì della settimana con passo
   * settimanale, `YYYY-MM` con passo mensile.
   */
  period: string;
  /** L'intervallo è coperto solo in parte dai movimenti osservati. */
  partial: boolean;
  income: number;
  expenses: number;
  withdrawals: number;
  loans: number;
  transfers: number;
  netMovement: number;
}

export interface Timeline {
  granularity: TimelineGranularity;
  buckets: TimelineBucket[];
}

export interface LoanEntry {
  id: string;
  bookingDate: string;
  description: string;
  merchant: string | null;
  amount: number;
}

export interface LoansSection {
  lent: number;
  transactionCount: number;
  entries: LoanEntry[];
}

/** Tutto ciò che la dashboard mostra, in una sola risposta. */
export interface Analytics {
  period: AnalyticsPeriod;
  query: AnalyticsQuery;
  overview: AnalyticsOverview;
  counts: AnalyticsCounts;
  byCategory: CategoryDistribution[];
  byMerchant: MerchantDistribution[];
  timeline: Timeline;
  loans: LoansSection;
}
