import { atomically } from '../../db/client.js';
import { NotFoundError } from '../../shared/errors.js';
import { merchantsService, type MerchantWithCategory } from '../merchants/index.js';
import type { TransactionQuery } from './transaction-query.js';
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

/** Una pagina di risultati, con quanti ce ne sono in tutto. */
export interface TransactionPage {
  transactions: TransactionWithMerchant[];
  /** Pagina effettivamente restituita: una richiesta oltre l'ultima viene riportata all'ultima. */
  page: number;
  pageSize: number;
  /** Transazioni che soddisfano i criteri, non quelle di questa pagina. */
  total: number;
  totalPages: number;
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

  /**
   * Una singola transazione, oppure `null`.
   *
   * Serve alle feature che vi si appoggiano per validare un riferimento: un
   * prestito nasce da un movimento, e deve poter verificare che esista e che
   * natura abbia.
   */
  findById(id: string): Transaction | null {
    return transactionsRepository.findById(id);
  },

  /** Una singola transazione con il proprio merchant, oppure `null`. */
  findByIdWithMerchant(id: string): TransactionWithMerchant | null {
    const transaction = transactionsRepository.findById(id);

    return transaction === null ? null : (withMerchant([transaction])[0] ?? null);
  },

  /** Le transazioni di un mese (`YYYY-MM`), arricchite con il merchant. */
  listByMonthWithMerchant(month: string): TransactionWithMerchant[] {
    return withMerchant(transactionsRepository.findByMonth(month));
  },

  /**
   * Le transazioni comprese fra due date contabili (`YYYY-MM-DD`), estremi
   * inclusi, arricchite con il merchant. `null` significa "nessun limite".
   *
   * È la lettura su cui si appoggia l'analisi per periodo: la selezione avviene
   * nel database, così le feature a valle non devono conoscerlo.
   */
  listBetweenWithMerchant(from: string | null, to: string | null): TransactionWithMerchant[] {
    return withMerchant(transactionsRepository.findBetween(from, to));
  },

  /**
   * Cerca le transazioni che soddisfano i criteri, una pagina alla volta.
   *
   * Filtri, ordinamento e paginazione sono eseguiti dal database; qui resta la
   * sola composizione con il merchant, la stessa usata da tutte le altre
   * letture. Una pagina oltre l'ultima viene riportata all'ultima: un
   * segnalibro vecchio continua a mostrare qualcosa.
   */
  search(query: TransactionQuery): TransactionPage {
    const firstAttempt = transactionsRepository.search(query);
    const totalPages = Math.max(Math.ceil(firstAttempt.total / query.pageSize), 1);

    const { transactions, total } =
      query.page <= totalPages
        ? firstAttempt
        : transactionsRepository.search({ ...query, page: totalPages });

    return {
      transactions: withMerchant(transactions),
      page: Math.min(query.page, totalPages),
      pageSize: query.pageSize,
      total,
      totalPages,
    };
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
   *
   * L'intera operazione è una sola transazione, letture comprese. Non è solo
   * per non lasciarla a metà: i fingerprint vengono assegnati evitando quelli
   * già presi, quindi l'elenco dei presi e le scritture che lo estendono
   * devono vedere lo stesso archivio. Interrotta a metà, l'operazione
   * riprenderebbe da un insieme diverso da quello su cui aveva deciso.
   */
  backfillFingerprints(): number {
    return atomically(() => {
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
    });
  },
};
