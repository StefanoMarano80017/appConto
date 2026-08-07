/** Natura finanziaria di un movimento, come definita dal backend. */
export const TRANSACTION_TYPES = [
  'EXPENSE',
  'INCOME',
  'WITHDRAWAL',
  'LOAN',
  'TRANSFER',
  'OTHER'
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  EXPENSE: 'Spesa',
  INCOME: 'Entrata',
  WITHDRAWAL: 'Prelievo',
  LOAN: 'Prestito',
  TRANSFER: 'Trasferimento',
  OTHER: 'Altro'
};

/** Etichette al plurale, per i totali aggregati. */
export const TRANSACTION_TYPE_PLURAL_LABELS: Record<TransactionType, string> = {
  EXPENSE: 'Spese',
  INCOME: 'Entrate',
  WITHDRAWAL: 'Prelievi',
  LOAN: 'Prestiti',
  TRANSFER: 'Trasferimenti',
  OTHER: 'Altro'
};

/** Tipi che non concorrono alle spese del mese: utile per segnalarli a video. */
export function isSpending(type: TransactionType): boolean {
  return type === 'EXPENSE';
}
