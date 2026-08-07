import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db } from '../../db/client.js';
import { transactionTypeSchema, type TransactionType } from './transaction-type.js';
import { toAmountCents, type Transaction } from './transaction.model.js';
import { transactions } from './transactions.schema.js';

/** SQLite limita il numero di parametri per statement: lavoriamo a blocchi. */
const CHUNK_SIZE = 500;

type TransactionRow = typeof transactions.$inferSelect;

export interface TypeTotalRow {
  type: string;
  transactionCount: number;
  totalCents: number;
}

export interface MerchantStatsRow {
  merchantId: string | null;
  transactionCount: number;
  totalSpentCents: number;
  lastBookingDate: string;
}

function toRow(transaction: Transaction): TransactionRow {
  return {
    id: transaction.id,
    bookingDate: transaction.bookingDate,
    description: transaction.description,
    amountCents: toAmountCents(transaction.amount),
    merchantId: transaction.merchantId,
    fingerprint: transaction.fingerprint,
    type: transaction.type,
  };
}

/** Un tipo non riconosciuto non deve rompere la lettura: vale `OTHER`. */
function toDomainType(value: string): TransactionType {
  const parsed = transactionTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'OTHER';
}

function toDomain(row: TransactionRow): Transaction {
  return {
    id: row.id,
    bookingDate: row.bookingDate,
    description: row.description,
    amount: row.amountCents / 100,
    merchantId: row.merchantId,
    fingerprint: row.fingerprint,
    type: toDomainType(row.type),
  };
}

/** Somma e conteggio per tipo, sui movimenti selezionati dalla condizione. */
function typeTotalsQuery(where: SQL | undefined): TypeTotalRow[] {
  const query = db
    .select({
      type: transactions.type,
      transactionCount: count(),
      totalCents: sql<number>`sum(${transactions.amountCents})`,
    })
    .from(transactions);

  return (where === undefined ? query : query.where(where)).groupBy(transactions.type).all();
}

export const transactionsRepository = {
  insertMany(items: readonly Transaction[]): void {
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE).map(toRow);
      db.insert(transactions).values(chunk).run();
    }
  },

  findAll(): Transaction[] {
    return db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.bookingDate), asc(transactions.description))
      .all()
      .map(toDomain);
  },

  /**
   * Transazioni di un mese.
   *
   * `booking_date` è memorizzata in formato ISO `YYYY-MM-DD`: il confronto per
   * prefisso è quindi sufficiente e non richiede conversioni di data.
   */
  findByMonth(month: string): Transaction[] {
    return db
      .select()
      .from(transactions)
      .where(like(transactions.bookingDate, `${month}-%`))
      .orderBy(desc(transactions.bookingDate), asc(transactions.description))
      .all()
      .map(toDomain);
  },

  findById(id: string): Transaction | null {
    const row = db.select().from(transactions).where(eq(transactions.id, id)).get();
    return row === undefined ? null : toDomain(row);
  },

  updateType(id: string, type: TransactionType): void {
    db.update(transactions).set({ type }).where(eq(transactions.id, id)).run();
  },

  /**
   * Totali per tipo dei movimenti di un mese (`YYYY-MM`).
   */
  totalsByTypeForMonth(month: string): TypeTotalRow[] {
    return typeTotalsQuery(like(transactions.bookingDate, `${month}-%`));
  },

  /**
   * Totali per tipo dei movimenti successivi a `after` e precedenti a `before`,
   * estremi esclusi. `null` significa "nessun limite".
   */
  totalsByTypeInRange(after: string | null, before: string | null): TypeTotalRow[] {
    const bounds = [
      after === null ? undefined : gt(transactions.bookingDate, after),
      before === null ? undefined : lt(transactions.bookingDate, before),
    ].filter((bound) => bound !== undefined);

    return typeTotalsQuery(bounds.length === 0 ? undefined : and(...bounds));
  },

  /**
   * Totali per merchant, calcolati dal database ad ogni richiesta.
   *
   * Nessun valore aggregato viene memorizzato: `GROUP BY` sulla sola tabella
   * delle transazioni.
   */
  statsByMerchant(): MerchantStatsRow[] {
    return db
      .select({
        merchantId: transactions.merchantId,
        transactionCount: count(),
        // Solo le uscite, in valore assoluto: le entrate non sono "speso".
        totalSpentCents: sql<number>`sum(case when ${transactions.amountCents} < 0 then -${transactions.amountCents} else 0 end)`,
        lastBookingDate: sql<string>`max(${transactions.bookingDate})`,
      })
      .from(transactions)
      .where(isNotNull(transactions.merchantId))
      .groupBy(transactions.merchantId)
      .all();
  },

  /** Quali dei fingerprint indicati sono già presenti in archivio. */
  findExistingFingerprints(fingerprints: readonly string[]): string[] {
    const found: string[] = [];

    for (let i = 0; i < fingerprints.length; i += CHUNK_SIZE) {
      const chunk = fingerprints.slice(i, i + CHUNK_SIZE);
      found.push(
        ...db
          .select({ fingerprint: transactions.fingerprint })
          .from(transactions)
          .where(inArray(transactions.fingerprint, chunk))
          .all()
          .flatMap((row) => (row.fingerprint === null ? [] : [row.fingerprint])),
      );
    }

    return found;
  },

  findAllFingerprints(): string[] {
    return db
      .select({ fingerprint: transactions.fingerprint })
      .from(transactions)
      .all()
      .flatMap((row) => (row.fingerprint === null ? [] : [row.fingerprint]));
  },

  /** Transazioni importate prima dell'introduzione del fingerprint. */
  findWithoutFingerprint(): Transaction[] {
    return db
      .select()
      .from(transactions)
      .where(isNull(transactions.fingerprint))
      .all()
      .map(toDomain);
  },

  updateFingerprint(id: string, fingerprint: string): void {
    db.update(transactions).set({ fingerprint }).where(eq(transactions.id, id)).run();
  },
};
