import type { CashFlowViewModel } from '../cash-flow/index.js';
import type { SummaryViewModel } from '../summary/index.js';
import type { TransactionDto } from '../transactions/index.js';
import type { DashboardFilters } from './dashboard-filters.js';

/**
 * Vista aggregata della dashboard.
 *
 * Non è un'entità e non viene mai persistita: raccoglie in una sola risposta
 * tutto ciò che la schermata mostra, così le sezioni non possono divergere fra
 * loro né rispetto ai filtri applicati.
 */

/** Transazione ridotta all'essenziale, per il terzo livello del drill down. */
export interface TransactionRef {
  id: string;
  bookingDate: string;
  description: string;
  /** Importo della spesa, in valore assoluto. */
  amount: number;
}

export interface MerchantBreakdown {
  id: string;
  /** Nome scelto dall'utente, altrimenti quello della banca. */
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
  /** Merchant della categoria, dal più speso al meno speso. */
  merchants: MerchantBreakdown[];
}

export interface TopMerchant {
  id: string;
  label: string;
  /** Solo spese reali, in valore assoluto. */
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
  /** `current - previous`: positivo = si è speso di più. */
  difference: number;
}

export interface MonthComparison {
  previousMonth: string;
  currentExpenses: number;
  previousExpenses: number;
  difference: number;
  /** `null` quando il mese precedente non ha spese: la variazione non è calcolabile. */
  percentChange: number | null;
  /** Categorie presenti in almeno uno dei due mesi, per variazione più marcata. */
  byCategory: CategoryComparison[];
}

export interface DashboardViewModel {
  month: string;
  /** Filtri effettivamente applicati, riproposti al chiamante. */
  filters: DashboardFilters;
  summary: SummaryViewModel;
  /** La liquidità dipende dal solo mese: filtrarla non avrebbe significato. */
  cashFlow: CashFlowViewModel;
  categories: CategoryBreakdown[];
  topMerchants: TopMerchant[];
  comparison: MonthComparison;
  /** Le transazioni del mese che soddisfano i filtri. */
  transactions: TransactionDto[];
}
