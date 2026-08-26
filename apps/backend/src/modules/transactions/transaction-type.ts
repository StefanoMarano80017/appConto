import { z } from 'zod';

/**
 * Natura finanziaria di un movimento.
 *
 * Un importo negativo non è sempre una spesa: un prelievo trasforma denaro in
 * contante, un trasferimento lo sposta su un altro conto, un prestito è denaro
 * che si attende indietro. Il tipo è ciò che permette di distinguerli.
 *
 * Il tipo però è una sola etichetta su un movimento che può essere due cose
 * insieme: un pagamento di 1.920 € in cui 890 € sono spesa propria e 1.030 €
 * sono stati anticipati per qualcun altro. Per questo la ripartizione fra
 * spesa e credito non si legge dal solo tipo: le funzioni in fondo al file
 * ricevono anche quanto del movimento è stato attribuito a dei prestiti.
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

/** Solo le entrate reali entrano nel totale delle entrate. */
export function isIncome(type: TransactionType): boolean {
  return type === 'INCOME';
}

/**
 * Ogni riga di un estratto conto ha spostato denaro sul conto: tutti i tipi
 * concorrono quindi al saldo. La funzione esiste per renderlo esplicito.
 */
export function affectsAccountBalance(_type: TransactionType): boolean {
  return true;
}

/**
 * Ripartizione di un movimento fra spesa propria e credito.
 *
 * `lentCents` è quanto del movimento è stato attribuito a dei prestiti: lo
 * conosce la feature `loans`, che lo passa qui. In questo modo la regola vive
 * in un solo posto e `transactions` non deve conoscere il dominio dei prestiti.
 */

/** Quanto è uscito dal conto, in centesimi positivi. Zero per un accredito. */
function outflowCents(amountCents: number): number {
  return Math.max(-amountCents, 0);
}

/**
 * La parte del movimento che è diventata un credito invece di una spesa.
 *
 * Riguarda solo i movimenti di tipo prestito. Finché nessun prestito è stato
 * registrato non si sa chi ha ricevuto il denaro né quanto: si considera
 * prestato tutto, che è l'ipotesi prudente — l'alternativa sarebbe contare
 * come spesa denaro che si attende indietro.
 *
 * Registrato un prestito, la ripartizione è nota: quella è la quota di credito,
 * il resto è spesa.
 */
export function creditCents(
  type: TransactionType,
  amountCents: number,
  lentCents: number,
): number {
  if (type !== 'LOAN') {
    return 0;
  }

  const outflow = outflowCents(amountCents);

  return lentCents > 0 ? Math.min(lentCents, outflow) : outflow;
}

/**
 * Quanto del movimento è spesa reale, in centesimi positivi.
 *
 * Per una spesa è l'importo intero, segno invertito: un importo positivo su un
 * movimento marcato come spesa resta un rimborso, e riduce il totale.
 *
 * Per un prestito è la quota **non** prestata. È il caso di un pagamento unico
 * che copre sia una cosa propria sia un anticipo per un'altra persona: la
 * prima è spesa, il secondo è credito.
 */
export function expenseCents(
  type: TransactionType,
  amountCents: number,
  lentCents: number,
): number {
  if (type === 'EXPENSE') {
    return -amountCents;
  }
  if (type === 'LOAN') {
    return outflowCents(amountCents) - creditCents(type, amountCents, lentCents);
  }

  return 0;
}

/**
 * Il movimento contiene una spesa, in tutto o in parte.
 *
 * È il criterio per entrare nei totali delle uscite e nelle categorie. Una
 * spesa vi entra sempre; un prestito solo per la quota che non è credito.
 */
export function hasExpense(
  type: TransactionType,
  amountCents: number,
  lentCents: number,
): boolean {
  return type === 'EXPENSE' || expenseCents(type, amountCents, lentCents) > 0;
}

/**
 * Contributo del movimento al patrimonio, con segno.
 *
 * Prelievi e trasferimenti non lo cambiano: il contante prelevato resta
 * proprio, un giroconto cambia solo conto. Un prestito non lo cambia per la
 * quota diventata credito, ma lo riduce per la quota realmente spesa.
 */
export function netWorthCents(
  type: TransactionType,
  amountCents: number,
  lentCents: number,
): number {
  if (type === 'WITHDRAWAL' || type === 'TRANSFER') {
    return 0;
  }
  if (type === 'LOAN') {
    // Lo zero resta zero: `-0` sopravvive ai confronti e si porta dietro sorprese.
    const expense = expenseCents(type, amountCents, lentCents);

    return expense === 0 ? 0 : -expense;
  }

  return amountCents;
}
