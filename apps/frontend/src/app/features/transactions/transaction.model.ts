import { Merchant } from '../merchants/merchant.model';
import { TransactionType } from './transaction-type';

/** Transazione così come viene esposta dalle API del backend. */
export interface Transaction {
  id: string;
  /** Data contabile in formato ISO `YYYY-MM-DD`. */
  bookingDate: string;
  description: string;
  /** Importo in euro: negativo = uscita, positivo = entrata. */
  amount: number;
  /** Natura finanziaria del movimento. */
  type: TransactionType;
  /** Null per le transazioni importate prima dell'introduzione dei merchant. */
  merchant: Merchant | null;
}

/** Una pagina di risultati, con le informazioni per navigare fra le altre. */
export interface TransactionPage {
  items: Transaction[];
  pagination: {
    page: number;
    pageSize: number;
    /** Transazioni che soddisfano i criteri, non quelle di questa pagina. */
    total: number;
    totalPages: number;
  };
}
