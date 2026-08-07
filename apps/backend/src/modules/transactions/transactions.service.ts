import { NotFoundError } from '../../shared/errors.js';
import { merchantsService, type MerchantWithCategory } from '../merchants/index.js';
import { transactionFingerprint } from './transaction-fingerprint.js';
import { transactionTypeSchema, type TransactionType } from './transaction-type.js';
import { createTransaction, type NewTransaction, type Transaction } from './transaction.model.js';
import { transactionsRepository, type TypeTotalRow } from './transactions.repository.js';

/** Totale dei movimenti di un certo tipo. */
export interface TypeTotal {
  type: TransactionType;
  transactionCount: number;
  /** Somma con segno: negativa se il denaro è uscito dal conto. */
  total: number;
}

/**
 * Transazione con il merchant a cui è associata.
 *
 * La categoria arriva già dentro il merchant: la transazione non la conosce.
 */
export interface TransactionWithMerchant {
  transaction: Transaction;
  merchant: MerchantWithCategory | null;
}

/** Totali delle transazioni di un merchant, sempre ricalcolati. */
export interface MerchantTransactionStats {
  transactionCount: number;
  /** Somma delle sole uscite, in valore assoluto. */
  totalSpent: number;
  /** Data contabile della transazione più recente. */
  lastTransactionDate: string;
}

/** Scarta eventuali tipi non riconosciuti e riporta gli importi in euro. */
function toTypeTotals(rows: readonly TypeTotalRow[]): TypeTotal[] {
  return rows.flatMap((row) => {
    const type = transactionTypeSchema.safeParse(row.type);
    if (!type.success) {
      return [];
    }

    return [
      {
        type: type.data,
        transactionCount: Number(row.transactionCount),
        total: Number(row.totalCents) / 100,
      },
    ];
  });
}

/** Associa ad ogni transazione il proprio merchant, letto dalla feature `merchants`. */
function withMerchant(transactions: readonly Transaction[]): TransactionWithMerchant[] {
  const merchantsById = new Map(
    merchantsService.listAllWithCategory().map((entry) => [entry.merchant.id, entry]),
  );

  return transactions.map((transaction) => ({
    transaction,
    merchant:
      transaction.merchantId === null ? null : (merchantsById.get(transaction.merchantId) ?? null),
  }));
}

/**
 * Servizio pubblico della feature: è l'unico punto di accesso
 * consentito alle altre feature (es. import, summary).
 */
export const transactionsService = {
  listAll(): Transaction[] {
    return transactionsRepository.findAll();
  },

  /** Le transazioni arricchite con il merchant, letto dalla feature `merchants`. */
  listAllWithMerchant(): TransactionWithMerchant[] {
    return withMerchant(transactionsRepository.findAll());
  },

  /** Le transazioni di un mese (`YYYY-MM`), arricchite con il merchant. */
  listByMonthWithMerchant(month: string): TransactionWithMerchant[] {
    return withMerchant(transactionsRepository.findByMonth(month));
  },

  /**
   * Corregge la natura di un movimento.
   *
   * È l'unico dato modificabile di una transazione già importata: data,
   * descrizione e importo restano quelli originali della banca.
   */
  updateType(id: string, type: TransactionType): Transaction {
    const transaction = transactionsRepository.findById(id);
    if (transaction === null) {
      throw new NotFoundError(`Transazione "${id}" non trovata.`);
    }

    transactionsRepository.updateType(id, type);

    return { ...transaction, type };
  },

  /** Totali per tipo dei movimenti di un mese (`YYYY-MM`). */
  totalsByTypeForMonth(month: string): TypeTotal[] {
    return toTypeTotals(transactionsRepository.totalsByTypeForMonth(month));
  },

  /**
   * Totali per tipo dei movimenti compresi fra due date, estremi esclusi.
   *
   * @param after `null` per partire dall'inizio dell'archivio
   * @param before `null` per arrivare fino all'ultimo movimento
   */
  totalsByTypeInRange(after: string | null, before: string | null): TypeTotal[] {
    return toTypeTotals(transactionsRepository.totalsByTypeInRange(after, before));
  },

  /**
   * Totali per merchant, indicizzati per identificativo.
   *
   * Permette alle altre feature di conoscere i numeri delle transazioni
   * senza leggerle: i valori sono calcolati, mai memorizzati.
   */
  statsByMerchant(): Map<string, MerchantTransactionStats> {
    const stats = new Map<string, MerchantTransactionStats>();

    for (const row of transactionsRepository.statsByMerchant()) {
      if (row.merchantId === null) {
        continue;
      }

      stats.set(row.merchantId, {
        transactionCount: Number(row.transactionCount),
        totalSpent: Number(row.totalSpentCents) / 100,
        lastTransactionDate: row.lastBookingDate,
      });
    }

    return stats;
  },

  /** Quali fra i fingerprint indicati appartengono a transazioni già archiviate. */
  findExistingFingerprints(fingerprints: readonly string[]): Set<string> {
    return new Set(transactionsRepository.findExistingFingerprints(fingerprints));
  },

  saveAll(newTransactions: readonly NewTransaction[]): Transaction[] {
    const created = newTransactions.map(createTransaction);
    transactionsRepository.insertMany(created);
    return created;
  },

  /**
   * Calcola il fingerprint delle transazioni importate prima della sua
   * introduzione, così anche i dati esistenti sono protetti dai duplicati.
   *
   * Il progressivo è il primo libero: transazioni identiche già presenti
   * ricevono gli stessi fingerprint che avrebbe prodotto un import.
   */
  backfillFingerprints(): number {
    const pending = transactionsRepository.findWithoutFingerprint();
    if (pending.length === 0) {
      return 0;
    }

    const taken = new Set(transactionsRepository.findAllFingerprints());

    for (const transaction of pending) {
      let occurrence = 0;
      let fingerprint = transactionFingerprint(transaction, occurrence);
      while (taken.has(fingerprint)) {
        occurrence += 1;
        fingerprint = transactionFingerprint(transaction, occurrence);
      }

      taken.add(fingerprint);
      transactionsRepository.updateFingerprint(transaction.id, fingerprint);
    }

    return pending.length;
  },
};
