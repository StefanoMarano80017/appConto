/** Riepilogo mensile, così come viene esposto dalle API del backend. */

export interface CategorySummary {
  id: string;
  name: string;
  color: string | null;
  /** Totale delle uscite della categoria, in valore assoluto. */
  amount: number;
  transactionCount: number;
}

export interface UncategorizedSummary {
  amount: number;
  transactionCount: number;
}

export interface Summary {
  month: string;
  income: number;
  /** Somma delle uscite, in valore assoluto. */
  expenses: number;
  balance: number;
  transactionCount: number;
  merchantCount: number;
  /** Solo le categorie presenti nel mese, per importo decrescente. */
  amountByCategory: CategorySummary[];
  uncategorized: UncategorizedSummary;
}
