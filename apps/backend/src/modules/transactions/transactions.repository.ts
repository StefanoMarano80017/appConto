import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { atomically, db } from '../../db/client.js';
import { escapeLike } from '../../shared/sql.js';
import { categories } from '../categories/categories.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import type { TransactionQuery } from './transaction-query.js';
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

/**
 * Le condizioni della ricerca.
 *
 * Categoria e classificazione guardano `merchants.category_id`: la transazione
 * non conosce la categoria, la eredita dal proprio merchant.
 */
function searchConditions(query: TransactionQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.from !== null) {
    conditions.push(gte(transactions.bookingDate, query.from));
  }
  if (query.to !== null) {
    conditions.push(lte(transactions.bookingDate, query.to));
  }
  if (query.types.length > 0) {
    conditions.push(inArray(transactions.type, [...query.types]));
  }
  if (query.merchantIds.length > 0) {
    conditions.push(inArray(transactions.merchantId, [...query.merchantIds]));
  }
  if (query.categoryIds.length > 0) {
    conditions.push(inArray(merchants.categoryId, [...query.categoryIds]));
  }
  if (query.classification === 'classified') {
    conditions.push(isNotNull(merchants.categoryId));
  }
  if (query.classification === 'unclassified') {
    conditions.push(isNull(merchants.categoryId));
  }
  // Il confronto è sul valore assoluto: "almeno 100 €" vale per entrate e uscite.
  if (query.minAmountCents !== null) {
    conditions.push(sql`abs(${transactions.amountCents}) >= ${query.minAmountCents}`);
  }
  if (query.maxAmountCents !== null) {
    conditions.push(sql`abs(${transactions.amountCents}) <= ${query.maxAmountCents}`);
  }

  if (query.search !== null) {
    const pattern = `%${escapeLike(query.search.toLowerCase())}%`;
    const matches = or(
      sql`lower(${transactions.description}) like ${pattern} escape '\\'`,
      sql`lower(${merchants.name}) like ${pattern} escape '\\'`,
      sql`lower(${merchants.displayName}) like ${pattern} escape '\\'`,
    );
    if (matches !== undefined) {
      conditions.push(matches);
    }
  }

  return conditions.length === 0 ? undefined : and(...conditions);
}

/** L'ordinamento richiesto, più due criteri stabili: la stessa pagina resta la stessa. */
function searchOrder(query: TransactionQuery): SQL[] {
  const direction = query.sortDirection === 'asc' ? asc : desc;

  const column = {
    bookingDate: sql`${transactions.bookingDate}`,
    amount: sql`${transactions.amountCents}`,
    merchant: sql`coalesce(${merchants.displayName}, ${merchants.name})`,
    category: sql`${categories.name}`,
    type: sql`${transactions.type}`,
  }[query.sortBy];

  return [direction(column), asc(transactions.description), asc(transactions.id)];
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
  /**
   * Archivia le transazioni indicate, tutte o nessuna.
   *
   * I blocchi sono un limite di SQLite sul numero di parametri per statement,
   * non un modo di procedere a rate: senza la transazione, un errore al terzo
   * blocco lascerebbe archiviati i primi due, e un archivio riempito per metà
   * è indistinguibile — guardandolo dopo — da un archivio completo.
   */
  insertMany(items: readonly Transaction[]): void {
    atomically(() => {
      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE).map(toRow);
        db.insert(transactions).values(chunk).run();
      }
    });
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

  /**
   * Transazioni comprese fra due date contabili, estremi inclusi.
   *
   * `null` significa "nessun limite": è la query di analisi su cui si appoggia
   * la feature `analytics`, che non conosce SQLite.
   */
  findBetween(from: string | null, to: string | null): Transaction[] {
    const bounds = [
      from === null ? undefined : gte(transactions.bookingDate, from),
      to === null ? undefined : lte(transactions.bookingDate, to),
    ].filter((bound) => bound !== undefined);

    const query = db.select().from(transactions);

    return (bounds.length === 0 ? query : query.where(and(...bounds)))
      .orderBy(desc(transactions.bookingDate), asc(transactions.description))
      .all()
      .map(toDomain);
  },

  /**
   * Una pagina di transazioni che soddisfano i criteri, più quante ne esistono
   * in tutto.
   *
   * Selezione, ordinamento e paginazione avvengono nel database: in memoria non
   * arriva mai più di una pagina. Il conteggio usa gli stessi join e le stesse
   * condizioni, quindi non può discordare dalle righe restituite.
   */
  search(query: TransactionQuery): { transactions: Transaction[]; total: number } {
    const where = searchConditions(query);
    const offset = (query.page - 1) * query.pageSize;

    const rows = db
      .select({
        id: transactions.id,
        bookingDate: transactions.bookingDate,
        description: transactions.description,
        amountCents: transactions.amountCents,
        merchantId: transactions.merchantId,
        fingerprint: transactions.fingerprint,
        type: transactions.type,
      })
      .from(transactions)
      .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
      .leftJoin(categories, eq(merchants.categoryId, categories.id))
      .where(where)
      .orderBy(...searchOrder(query))
      .limit(query.pageSize)
      .offset(offset)
      .all();

    const total = db
      .select({ value: count() })
      .from(transactions)
      .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
      .leftJoin(categories, eq(merchants.categoryId, categories.id))
      .where(where)
      .get();

    return { transactions: rows.map(toDomain), total: Number(total?.value ?? 0) };
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
