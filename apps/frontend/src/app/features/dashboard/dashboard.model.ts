import { CashFlow } from '../cash-flow/cash-flow.model';
import { Transaction } from '../transactions/transaction.model';
import { TransactionType } from '../transactions/transaction-type';

/** Riepilogo del mese, calcolato sulle transazioni filtrate. */
export interface Summary {
  month: string;
  income: number;
  expenses: number;
  balance: number;
  transactionCount: number;
  merchantCount: number;
  amountByCategory: {
    id: string;
    name: string;
    color: string | null;
    amount: number;
    transactionCount: number;
  }[];
  uncategorized: { amount: number; transactionCount: number };
}

export interface TransactionRef {
  id: string;
  bookingDate: string;
  description: string;
  amount: number;
}

export interface MerchantBreakdown {
  id: string;
  label: string;
  amount: number;
  transactionCount: number;
  transactions: TransactionRef[];
}

export interface CategoryBreakdown {
  /** `null` per le spese di merchant non ancora classificati. */
  id: string | null;
  name: string;
  color: string | null;
  amount: number;
  transactionCount: number;
  merchants: MerchantBreakdown[];
}

export interface TopMerchant {
  id: string;
  label: string;
  amount: number;
  transactionCount: number;
  categoryName: string | null;
}

export interface CategoryComparison {
  id: string | null;
  name: string;
  color: string | null;
  current: number;
  previous: number;
  difference: number;
}

export interface MonthComparison {
  previousMonth: string;
  currentExpenses: number;
  previousExpenses: number;
  difference: number;
  /** `null` quando il mese precedente non ha spese. */
  percentChange: number | null;
  byCategory: CategoryComparison[];
}

/** Tutto ciò che la dashboard mostra, in una sola risposta. */
export interface Dashboard {
  month: string;
  filters: {
    type: TransactionType | null;
    categoryId: string | null;
    merchantId: string | null;
  };
  summary: Summary;
  cashFlow: CashFlow;
  categories: CategoryBreakdown[];
  topMerchants: TopMerchant[];
  comparison: MonthComparison;
  transactions: Transaction[];
}
