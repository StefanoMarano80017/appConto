import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { transactionTypeSchema } from './transaction-type.js';

/**
 * Modello di dominio.
 *
 * Non dipende da Express, da SQLite né da alcun formato di import:
 * rappresenta un movimento bancario già normalizzato.
 */

/** Transazione normalizzata dalla sorgente, prima della risoluzione del merchant. */
export const parsedTransactionSchema = z.object({
  /** Data contabile in formato ISO `YYYY-MM-DD`. */
  bookingDate: z.iso.date({ error: 'Data contabile non valida' }),
  /** Descrizione originale della banca: non viene mai modificata. */
  description: z.string().trim().min(1, { error: 'Descrizione mancante' }),
  /** Importo in euro. Negativo = uscita, positivo = entrata. */
  amount: z.number({ error: 'Importo non valido' }).finite({ error: 'Importo non valido' }),
  /** Natura finanziaria del movimento, correggibile dall'utente. */
  type: transactionTypeSchema,
});

export type ParsedTransaction = z.infer<typeof parsedTransactionSchema>;

/** Transazione a cui è già stata calcolata l'identità. */
export interface FingerprintedTransaction extends ParsedTransaction {
  fingerprint: string;
}

/** Transazione pronta per la persistenza: identità e merchant sono già risolti. */
export interface NewTransaction extends FingerprintedTransaction {
  merchantId: string;
}

/** Transazione persistita. Una volta importata è immutabile. */
export interface Transaction extends ParsedTransaction {
  id: string;
  /** Null solo per le transazioni importate prima dell'introduzione dei merchant. */
  merchantId: string | null;
  /** Null solo per le transazioni importate prima dell'introduzione del fingerprint. */
  fingerprint: string | null;
}

export function createTransaction(input: NewTransaction): Transaction {
  return { id: randomUUID(), ...input };
}

/**
 * Importo in centesimi.
 *
 * È la rappresentazione esatta dell'importo: viene usata sia per la
 * persistenza sia per il calcolo del fingerprint, così le due non possono
 * divergere.
 *
 * Sposta la virgola sulla rappresentazione decimale (non con `* 100`, che in
 * virgola mobile dà 100.49999 per 1.005) e arrotonda a metà lontano da zero,
 * in modo simmetrico: 1.005 dà 101 e -1.005 dà -101. Non restituisce mai -0.
 * L'esponente si somma a parte perché `String(1e-7)` è '1e-7' e '1e-7e2' non
 * è un numero.
 */
export function toAmountCents(amount: number): number {
  const [mantissa = '0', exponent = '0'] = String(Math.abs(amount)).split('e');
  const cents = Math.round(Number(`${mantissa}e${Number(exponent) + 2}`));
  if (cents === 0) {
    return 0;
  }

  return amount < 0 ? -cents : cents;
}
