import { createHash } from 'node:crypto';
import {
  toAmountCents,
  type FingerprintedTransaction,
  type ParsedTransaction,
} from './transaction.model.js';

/**
 * Identità di una transazione.
 *
 * Il fingerprint è calcolato sui dati originali dell'estratto conto, già
 * normalizzati: data contabile, importo in centesimi e descrizione. Non
 * dipende quindi né dal formato del CSV né dall'ordine delle colonne: lo
 * stesso movimento esportato due volte produce lo stesso fingerprint.
 *
 * `occurrence` distingue movimenti realmente identici avvenuti nello stesso
 * giorno (due caffè da 3,50 €): senza di esso il secondo verrebbe scambiato
 * per un duplicato e la spesa risulterebbe sottostimata.
 */

/** Carattere non stampabile: non può comparire nei campi, quindi non crea ambiguità. */
const FIELD_SEPARATOR = '\u0000';

function baseKey(transaction: ParsedTransaction): string {
  return [
    transaction.bookingDate,
    toAmountCents(transaction.amount),
    transaction.description,
  ].join(FIELD_SEPARATOR);
}

export function transactionFingerprint(
  transaction: ParsedTransaction,
  occurrence: number,
): string {
  return createHash('sha256')
    .update(`${baseKey(transaction)}${FIELD_SEPARATOR}${occurrence}`)
    .digest('hex');
}

/**
 * Calcola il fingerprint di un intero lotto.
 *
 * Il progressivo è assegnato in base alla posizione fra le transazioni
 * identiche dello stesso lotto: reimportando lo stesso file si ottengono
 * esattamente gli stessi fingerprint.
 */
export function fingerprintAll(
  transactions: readonly ParsedTransaction[],
): FingerprintedTransaction[] {
  const occurrences = new Map<string, number>();

  return transactions.map((transaction) => {
    const key = baseKey(transaction);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);

    return { ...transaction, fingerprint: transactionFingerprint(transaction, occurrence) };
  });
}
