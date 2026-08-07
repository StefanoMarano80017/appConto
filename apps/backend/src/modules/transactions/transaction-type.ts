import { z } from 'zod';

/**
 * Natura finanziaria di un movimento.
 *
 * Un importo negativo non è sempre una spesa: un prelievo trasforma denaro in
 * contante, un trasferimento lo sposta su un altro conto, un prestito è denaro
 * che si attende indietro. Il tipo è ciò che permette di distinguerli.
 */
export const TRANSACTION_TYPES = [
  'EXPENSE',
  'INCOME',
  'WITHDRAWAL',
  'LOAN',
  'TRANSFER',
  'OTHER',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const transactionTypeSchema = z.enum(TRANSACTION_TYPES);

/** Solo le spese reali entrano nel totale delle uscite e nelle categorie. */
export function isExpense(type: TransactionType): boolean {
  return type === 'EXPENSE';
}

/** Solo le entrate reali entrano nel totale delle entrate. */
export function isIncome(type: TransactionType): boolean {
  return type === 'INCOME';
}

/**
 * Tipi che spostano denaro senza cambiare quanto se ne possiede: il contante
 * prelevato resta proprio, un giroconto cambia solo conto, un prestito diventa
 * un credito. Incidono sul saldo del conto, non sul patrimonio.
 */
const NET_WORTH_NEUTRAL: readonly TransactionType[] = ['WITHDRAWAL', 'TRANSFER', 'LOAN'];

export function affectsNetWorth(type: TransactionType): boolean {
  return !NET_WORTH_NEUTRAL.includes(type);
}

/**
 * Ogni riga di un estratto conto ha spostato denaro sul conto: tutti i tipi
 * concorrono quindi al saldo. La funzione esiste per renderlo esplicito.
 */
export function affectsAccountBalance(_type: TransactionType): boolean {
  return true;
}
