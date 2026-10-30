import type { TransactionType } from '../transactions/index.js';

/**
 * Deduce la natura del movimento dalla tipologia dichiarata dalla banca.
 *
 * Nessuna intelligenza: solo il riconoscimento delle diciture inequivocabili.
 * Tutto il resto ricade sul segno dell'importo, e resta correggibile a mano.
 */

// Radici, non parole intere: coprono i plurali ('prelievi', 'accrediti') e le varianti.
const WITHDRAWAL_HINTS = ['preliev', 'prelevament'];
const INCOME_HINTS = ['accredit'];

export function resolveTransactionType(typeHint: string, amount: number): TransactionType {
  const hint = typeHint.trim().toLowerCase();

  if (WITHDRAWAL_HINTS.some((word) => hint.includes(word))) {
    return 'WITHDRAWAL';
  }
  if (INCOME_HINTS.some((word) => hint.includes(word))) {
    return 'INCOME';
  }

  return amount > 0 ? 'INCOME' : 'EXPENSE';
}
