import { TransactionType } from '../transactions/transaction-type';

export interface TypeBreakdown {
  type: TransactionType;
  /** Somma con segno: negativa se il denaro è uscito dal conto. */
  amount: number;
  transactionCount: number;
}

/** Andamento della liquidità, così come viene esposto dalle API del backend. */
export interface CashFlow {
  month: string | null;
  /** Saldo all'inizio del periodo, riporti inclusi. */
  openingBalance: number;
  balanceDate: string | null;
  income: number;
  /** Uscite reali del periodo, in valore assoluto. */
  expenses: number;
  /** Somma di tutti i movimenti del periodo. */
  netMovement: number;
  /** Quanto resta disponibile sul conto. */
  closingBalance: number;
  /** Variazione del patrimonio: esclude prelievi, trasferimenti e prestiti. */
  netWorthChange: number;
  transactionCount: number;
  byType: TypeBreakdown[];
}
