/**
 * Riepilogo mensile.
 *
 * Non è un'entità del dominio e non viene mai persistito: è la
 * rappresentazione destinata al frontend di un calcolo fatto sul momento.
 */

export interface CategorySummary {
  id: string;
  name: string;
  color: string | null;
  /** Totale delle uscite della categoria, in valore assoluto. */
  amount: number;
  transactionCount: number;
}

export interface UncategorizedSummary {
  /** Uscite di merchant senza categoria, in valore assoluto. */
  amount: number;
  transactionCount: number;
}

export interface SummaryViewModel {
  /** Mese di riferimento, in formato `YYYY-MM`. */
  month: string;
  /** Somma dei movimenti di tipo `INCOME`. */
  income: number;
  /** Somma dei movimenti di tipo `EXPENSE`, in valore assoluto. */
  expenses: number;
  /** `income - expenses`. */
  balance: number;
  transactionCount: number;
  /** Merchant distinti presenti nel mese. */
  merchantCount: number;
  /** Solo le categorie presenti nel mese, per importo decrescente. */
  amountByCategory: CategorySummary[];
  /** Uscite non ancora attribuite ad una categoria. */
  uncategorized: UncategorizedSummary;
}
