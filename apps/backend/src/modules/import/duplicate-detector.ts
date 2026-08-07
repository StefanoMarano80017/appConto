import { transactionsService, type FingerprintedTransaction } from '../transactions/index.js';

export interface DuplicateDetectionResult {
  /** Transazioni non ancora presenti in archivio. */
  toImport: FingerprintedTransaction[];
  /** Quante transazioni del lotto erano già state importate. */
  duplicates: number;
}

/**
 * Scarta le transazioni già presenti in archivio.
 *
 * Il confronto avviene sul fingerprint, con un'unica interrogazione:
 * questa fase non conosce il formato del CSV, solo l'identità delle transazioni.
 */
export function detectDuplicates(
  transactions: readonly FingerprintedTransaction[],
): DuplicateDetectionResult {
  const existing = transactionsService.findExistingFingerprints(
    transactions.map((transaction) => transaction.fingerprint),
  );

  const toImport = transactions.filter(
    (transaction) => !existing.has(transaction.fingerprint),
  );

  return { toImport, duplicates: transactions.length - toImport.length };
}
