import { Category } from '../categories/category.model';

/** Esercente, così come viene esposto dalle API del backend. */
export interface Merchant {
  id: string;
  /** Nome originale della banca. */
  name: string;
  /** Nome scelto dall'utente, se presente. */
  displayName: string | null;
  /** Nome da mostrare: `displayName` se valorizzato, altrimenti `name`. */
  label: string;
  normalizedName: string;
  /** Null finché l'utente non assegna una categoria. */
  category: Category | null;
}

/** Merchant con i totali delle sue transazioni. */
export interface MerchantSummary extends Merchant {
  transactionCount: number;
  /** Somma delle sole uscite, in valore assoluto. */
  totalSpent: number;
  /** Data contabile dell'ultima transazione, in formato ISO `YYYY-MM-DD`. */
  lastTransactionDate: string | null;
}
