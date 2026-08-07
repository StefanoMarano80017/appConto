import type { TransactionType } from '../transactions/index.js';

/**
 * Andamento della liquidità.
 *
 * Non è un'entità e non viene mai persistito: è il risultato di un calcolo
 * sui movimenti, a partire da un saldo noto.
 */

export interface TypeBreakdown {
  type: TransactionType;
  /** Somma con segno: negativa se il denaro è uscito dal conto. */
  amount: number;
  transactionCount: number;
}

export interface CashFlowViewModel {
  /** Mese osservato (`YYYY-MM`), oppure `null` per l'intero archivio. */
  month: string | null;
  /**
   * Saldo all'inizio del periodo: il saldo noto delle impostazioni più tutti
   * i movimenti avvenuti fra quella data e l'inizio del periodo.
   */
  openingBalance: number;
  /** Data del saldo noto. Null = tutti i movimenti sono considerati. */
  balanceDate: string | null;
  /** Somma dei movimenti di tipo `INCOME` nel periodo. */
  income: number;
  /** Somma dei movimenti di tipo `EXPENSE` nel periodo, in valore assoluto. */
  expenses: number;
  /** Somma di tutti i movimenti del periodo: ogni riga di estratto conto muove denaro. */
  netMovement: number;
  /** `openingBalance + netMovement`: quanto resta disponibile sul conto. */
  closingBalance: number;
  /**
   * Variazione del patrimonio: esclude prelievi, trasferimenti e prestiti,
   * che spostano denaro senza cambiare quanto se ne possiede.
   */
  netWorthChange: number;
  transactionCount: number;
  /** Dettaglio per tipo, dal movimento più negativo al più positivo. */
  byType: TypeBreakdown[];
}
