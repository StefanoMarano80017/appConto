import { and, asc, desc, eq, isNotNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { escapeLike } from '../../shared/sql.js';
import { transactions } from '../transactions/transactions.schema.js';
import type { LoanQuery } from './loan-query.js';
import type { Loan, LoanRepayment } from './loan.model.js';
import { loanRepayments, loans } from './loans.schema.js';

/**
 * Prestito con i totali delle sue restituzioni.
 *
 * Il residuo non viene restituito: è `amountCents - repaidCents`, e la sua
 * unica definizione vive nel dominio. Qui arrivano solo gli addendi.
 */
export interface LoanAggregate extends Loan {
  repaidCents: number;
  repaymentCount: number;
}

/** Restituzione già collegata ad un movimento bancario. */
export interface RepaymentLink {
  loanId: string;
  transactionId: string;
}

/**
 * Quanto di un movimento è stato attribuito a dei prestiti.
 *
 * È ciò che permette alle proiezioni finanziarie di ripartire un movimento fra
 * spesa propria e credito: un pagamento unico può essere entrambe le cose.
 * Porta con sé tipo, data e importo del movimento perché chi la usa non debba
 * rileggerlo.
 */
export interface LoanAllocation {
  transactionId: string;
  type: string;
  bookingDate: string;
  /** Importo del movimento in centesimi, con segno. */
  amountCents: number;
  /** Somma dei prestiti nati da questo movimento. */
  lentCents: number;
}

const REPAID_CENTS = sql<number>`coalesce(sum(${loanRepayments.amountCents}), 0)`;
const REMAINING_CENTS = sql<number>`${loans.amountCents} - coalesce(sum(${loanRepayments.amountCents}), 0)`;
const REPAYMENT_COUNT = sql<number>`count(${loanRepayments.id})`;

/**
 * Le colonne del prestito più i totali delle restituzioni.
 *
 * L'aggregazione avviene nel database: il residuo di ogni prestito nasce dalla
 * stessa `SUM` che alimenta filtro di stato e ordinamento, quindi non possono
 * discordare fra loro.
 */
const AGGREGATE_COLUMNS = {
  id: loans.id,
  transactionId: loans.transactionId,
  borrowerName: loans.borrowerName,
  description: loans.description,
  amountCents: loans.amountCents,
  lentAt: loans.lentAt,
  createdAt: loans.createdAt,
  repaidCents: REPAID_CENTS,
  repaymentCount: REPAYMENT_COUNT,
};

interface AggregateRow {
  id: string;
  transactionId: string;
  borrowerName: string;
  description: string | null;
  amountCents: number;
  lentAt: string;
  createdAt: string;
  repaidCents: number;
  repaymentCount: number;
}

function toAggregate(row: AggregateRow): LoanAggregate {
  return {
    id: row.id,
    transactionId: row.transactionId,
    borrowerName: row.borrowerName,
    description: row.description,
    amountCents: Number(row.amountCents),
    lentAt: row.lentAt,
    createdAt: row.createdAt,
    repaidCents: Number(row.repaidCents),
    repaymentCount: Number(row.repaymentCount),
  };
}

/**
 * Le condizioni che dipendono dalle sole colonne.
 *
 * La ricerca guarda anche la descrizione della transazione d'origine: un
 * prestito nato da «Mediaworld» si ritrova cercando "mediaworld" anche se
 * l'utente non l'ha riscritto nella descrizione del prestito.
 */
function loanConditions(query: LoanQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.borrower !== null) {
    conditions.push(sql`lower(${loans.borrowerName}) = ${query.borrower.toLowerCase()}`);
  }

  if (query.search !== null) {
    const pattern = `%${escapeLike(query.search.toLowerCase())}%`;
    const matches = or(
      sql`lower(${loans.borrowerName}) like ${pattern} escape '\\'`,
      sql`lower(${loans.description}) like ${pattern} escape '\\'`,
      sql`lower(${transactions.description}) like ${pattern} escape '\\'`,
    );
    if (matches !== undefined) {
      conditions.push(matches);
    }
  }

  return conditions.length === 0 ? undefined : and(...conditions);
}

/**
 * Lo stato non è una colonna: filtrarlo significa porre una condizione sul
 * risultato dell'aggregazione, quindi vive in `HAVING` e non in `WHERE`.
 */
function statusCondition(query: LoanQuery): SQL | undefined {
  if (query.status === 'open') {
    return sql`${REMAINING_CENTS} > 0`;
  }
  if (query.status === 'settled') {
    return sql`${REMAINING_CENTS} <= 0`;
  }

  return undefined;
}

/** L'ordinamento richiesto, più due criteri stabili: l'elenco non cambia da sé. */
function loanOrder(query: LoanQuery): SQL[] {
  const direction = query.sortDirection === 'asc' ? asc : desc;

  const column = {
    remainingAmount: REMAINING_CENTS,
    lentAt: sql`${loans.lentAt}`,
    amount: sql`${loans.amountCents}`,
    borrower: sql`lower(${loans.borrowerName})`,
  }[query.sortBy];

  return [direction(column), desc(loans.lentAt), asc(loans.id)];
}

export const loansRepository = {
  /**
   * I prestiti che soddisfano i criteri, con i totali delle restituzioni.
   *
   * Non è paginato: i prestiti di una persona si contano a decine, non a
   * migliaia. L'elenco restituito è quindi completo, e i totali calcolati su
   * di esso coincidono con ciò che si vede.
   */
  findAggregates(query: LoanQuery): LoanAggregate[] {
    return db
      .select(AGGREGATE_COLUMNS)
      .from(loans)
      .leftJoin(loanRepayments, eq(loanRepayments.loanId, loans.id))
      .leftJoin(transactions, eq(transactions.id, loans.transactionId))
      .where(loanConditions(query))
      .groupBy(loans.id)
      .having(statusCondition(query))
      .orderBy(...loanOrder(query))
      .all()
      .map(toAggregate);
  },

  findAggregateById(id: string): LoanAggregate | null {
    const row = db
      .select(AGGREGATE_COLUMNS)
      .from(loans)
      .leftJoin(loanRepayments, eq(loanRepayments.loanId, loans.id))
      .where(eq(loans.id, id))
      .groupBy(loans.id)
      .get();

    return row === undefined ? null : toAggregate(row);
  },

  /** Tutte le persone a cui è stato prestato qualcosa, in ordine alfabetico. */
  distinctBorrowers(): string[] {
    return db
      .selectDistinct({ borrowerName: loans.borrowerName })
      .from(loans)
      .orderBy(asc(sql`lower(${loans.borrowerName})`))
      .all()
      .map((row) => row.borrowerName);
  },

  /**
   * Quanto di una transazione è già stato attribuito a dei prestiti.
   *
   * Serve al tetto di capienza: la somma dei prestiti nati da uno stesso
   * movimento non può superare l'importo di quel movimento. `exceptLoanId`
   * esclude il prestito che si sta modificando, che altrimenti conterebbe
   * contro se stesso.
   */
  allocatedCentsByTransaction(transactionId: string, exceptLoanId?: string): number {
    const conditions = [eq(loans.transactionId, transactionId)];
    if (exceptLoanId !== undefined) {
      conditions.push(ne(loans.id, exceptLoanId));
    }

    const row = db
      .select({ total: sql<number>`coalesce(sum(${loans.amountCents}), 0)` })
      .from(loans)
      .where(and(...conditions))
      .get();

    return Number(row?.total ?? 0);
  },

  insert(loan: Loan): void {
    db.insert(loans).values(loan).run();
  },

  update(id: string, patch: Partial<Omit<Loan, 'id' | 'transactionId' | 'createdAt'>>): void {
    db.update(loans).set(patch).where(eq(loans.id, id)).run();
  },

  delete(id: string): void {
    db.delete(loans).where(eq(loans.id, id)).run();
  },

  /** Le restituzioni di un prestito, dalla più recente. */
  findRepayments(loanId: string): LoanRepayment[] {
    return db
      .select()
      .from(loanRepayments)
      .where(eq(loanRepayments.loanId, loanId))
      .orderBy(desc(loanRepayments.repaymentDate), desc(loanRepayments.createdAt))
      .all();
  },

  findRepaymentById(id: string): LoanRepayment | null {
    return db.select().from(loanRepayments).where(eq(loanRepayments.id, id)).get() ?? null;
  },

  /** Quanto è già stato restituito di un prestito. `exceptRepaymentId` esclude una riga. */
  repaidCents(loanId: string, exceptRepaymentId?: string): number {
    const conditions = [eq(loanRepayments.loanId, loanId)];
    if (exceptRepaymentId !== undefined) {
      conditions.push(ne(loanRepayments.id, exceptRepaymentId));
    }

    const row = db
      .select({ total: sql<number>`coalesce(sum(${loanRepayments.amountCents}), 0)` })
      .from(loanRepayments)
      .where(and(...conditions))
      .get();

    return Number(row?.total ?? 0);
  },

  insertRepayment(repayment: LoanRepayment): void {
    db.insert(loanRepayments).values(repayment).run();
  },

  updateRepayment(
    id: string,
    patch: Partial<Omit<LoanRepayment, 'id' | 'loanId' | 'createdAt'>>,
  ): void {
    db.update(loanRepayments).set(patch).where(eq(loanRepayments.id, id)).run();
  },

  deleteRepayment(id: string): void {
    db.delete(loanRepayments).where(eq(loanRepayments.id, id)).run();
  },

  /**
   * I movimenti che hanno prestiti registrati, con quanto è stato attribuito.
   *
   * Sono pochi — un prestito per volta, non uno per transazione — quindi
   * l'elenco completo è la lettura più semplice: chi lo usa filtra il periodo
   * che gli serve senza una query per volta.
   */
  findAllocations(): LoanAllocation[] {
    return db
      .select({
        transactionId: transactions.id,
        type: transactions.type,
        bookingDate: transactions.bookingDate,
        amountCents: transactions.amountCents,
        lentCents: sql<number>`coalesce(sum(${loans.amountCents}), 0)`,
      })
      .from(loans)
      .innerJoin(transactions, eq(transactions.id, loans.transactionId))
      .groupBy(transactions.id)
      .all()
      .map((row) => ({
        transactionId: row.transactionId,
        type: row.type,
        bookingDate: row.bookingDate,
        amountCents: Number(row.amountCents),
        lentCents: Number(row.lentCents),
      }));
  },

  /** Le restituzioni collegate ad un movimento bancario, per l'indice dell'esplorazione. */
  findRepaymentLinks(): RepaymentLink[] {
    return db
      .select({ loanId: loanRepayments.loanId, transactionId: loanRepayments.transactionId })
      .from(loanRepayments)
      .where(isNotNull(loanRepayments.transactionId))
      .all()
      .flatMap((row) =>
        row.transactionId === null
          ? []
          : [{ loanId: row.loanId, transactionId: row.transactionId }],
      );
  },
};
