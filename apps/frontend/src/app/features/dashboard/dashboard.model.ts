import { TransactionType } from '../transactions/transaction-type';

/*
 * Specchio di `dashboard.view-model.ts` e di `ComparisonWindow`
 * (`dashboard.period.ts`) nel backend: la forma di `GET /dashboard`.
 */

/** Intervallo del mese precedente da confrontare con il mese mostrato (date incluse). */
export interface ComparisonWindow {
  previousFrom: string;
  previousTo: string;
  /** Ultimo giorno del mese mostrato da considerare; `null` per un mese chiuso (mese intero). */
  currentTo: string | null;
  /** Vero se il mese mostrato è quello in corso e il confronto è a parità di giorni. */
  partial: boolean;
}

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

/** Tutto ciò che il riepilogo mostra, in una sola risposta. */
export interface Dashboard {
  month: string;
  /** La data del server: il frontend non legge l'orologio del browser. */
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
