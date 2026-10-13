import type { TransactionType } from '../transactions/index.js';
import type { ComparisonWindow } from './dashboard.period.js';

/**
 * Vista essenziale della landing del riepilogo.
 *
 * Non è un'entità e non viene mai persistita: raccoglie in una sola risposta
 * ciò che la schermata mostra, così le sezioni non possono divergere fra loro.
 */

export interface DashboardCategory {
  /** `null` per le spese di merchant non ancora classificati. */
  id: string | null;
  name: string;
  color: string | null;
  /** Spesa del mese mostrato, positiva. */
  amount: number;
  /** Quota sulle uscite del mese, un decimale; `null` se le uscite non sono positive. */
  percentage: number | null;
  /** Spesa nella finestra corrente meno quella della finestra precedente: positivo = si è speso di più. */
  difference: number;
}

export interface RecentTransaction {
  id: string;
  bookingDate: string;
  /** Nome scelto dall'utente o della banca; la descrizione se il merchant manca. */
  label: string;
  type: TransactionType;
  category: { id: string; name: string; color: string | null } | null;
  /** Con segno, come in banca. */
  amount: number;
}

export interface DashboardViewModel {
  month: string;
  today: string;
  /** Data dell'ultimo movimento dell'intero archivio; `null` se è vuoto. */
  lastTransactionDate: string | null;
  summary: { income: number; expenses: number; balance: number; withdrawals: number };
  comparison: {
    previousExpenses: number;
    /** `null` quando le spese precedenti sono zero: la variazione non è calcolabile. */
    percentChange: number | null;
  } & ComparisonWindow;
  /** Al massimo cinque, dalla più spesa. */
  topCategories: DashboardCategory[];
  /** Gli ultimi cinque movimenti dell'archivio, indipendenti dal mese. */
  recentTransactions: RecentTransaction[];
  attention: { unclassifiedMerchants: number };
  loans: { remaining: number; openCount: number; unlinkedTransactions: number };
}
