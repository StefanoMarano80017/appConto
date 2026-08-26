import type { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { toAmountCents, transactionsService, type Transaction } from '../transactions/index.js';
import { DEFAULT_LOAN_QUERY, type LoanQuery } from './loan-query.js';
import {
  createLoan,
  createRepayment,
  loanStatus,
  loanUpdateSchema,
  newLoanSchema,
  newRepaymentSchema,
  remainingCents,
  repaymentUpdateSchema,
  type Loan,
  type LoanRepayment,
} from './loan.model.js';
import { loansRepository, type LoanAggregate, type LoanAllocation } from './loans.repository.js';
import type {
  LinkedTransaction,
  LoanDetailViewModel,
  LoanLink,
  LoanLinksViewModel,
  LoanListViewModel,
  LoanRepaymentViewModel,
  LoanSummary,
  LoanTotals,
  OriginSplit,
} from './loans.view-model.js';

/**
 * Caso d'uso "gestione dei prestiti".
 *
 * È qui che vivono le regole del dominio, e in nessun altro posto:
 *
 *  - un prestito nasce da un movimento bancario di tipo `LOAN`;
 *  - la somma dei prestiti nati da uno stesso movimento non può superare
 *    l'importo di quel movimento;
 *  - una restituzione non può superare il credito residuo;
 *  - gli importi di prestiti e restituzioni sono sempre positivi: la
 *    direzione del denaro è già raccontata dalla transazione, ripeterla col
 *    segno significherebbe poterla contraddire.
 *
 * Il servizio non conosce Express né SQLite, e legge le transazioni solo
 * attraverso il servizio pubblico della feature `transactions`.
 */

/** Un importo in centesimi come lo si scrive in italiano. */
function euro(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

/** Il primo messaggio utile di una validazione fallita. */
function firstIssue(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

/**
 * Quanto denaro ha davvero mosso un movimento, in valore assoluto.
 *
 * È il tetto di capienza dei prestiti che ne derivano: il Loan può descrivere
 * una parte del movimento, mai più di quanto è uscito dal conto.
 */
function capacityCents(transaction: Transaction): number {
  return Math.abs(toAmountCents(transaction.amount));
}

function toLinkedTransaction(transaction: Transaction): LinkedTransaction {
  return {
    id: transaction.id,
    bookingDate: transaction.bookingDate,
    description: transaction.description,
    amount: transaction.amount,
    type: transaction.type,
  };
}

function toSummary(aggregate: LoanAggregate): LoanSummary {
  const remaining = remainingCents(aggregate.amountCents, aggregate.repaidCents);

  return {
    id: aggregate.id,
    transactionId: aggregate.transactionId,
    borrowerName: aggregate.borrowerName,
    description: aggregate.description,
    lentAt: aggregate.lentAt,
    amount: aggregate.amountCents / 100,
    repaidAmount: aggregate.repaidCents / 100,
    remainingAmount: remaining / 100,
    status: loanStatus(remaining),
    repaymentCount: aggregate.repaymentCount,
  };
}

function requireLoan(id: string): LoanAggregate {
  const aggregate = loansRepository.findAggregateById(id);
  if (aggregate === null) {
    throw new NotFoundError(`Prestito "${id}" non trovato.`);
  }

  return aggregate;
}

/**
 * La transazione da cui può nascere un prestito.
 *
 * Un prestito non si attacca ad una spesa o ad uno stipendio: il movimento
 * deve essere stato riconosciuto come prestito. Se il tipo è sbagliato la
 * correzione va fatta dall'elenco movimenti, non aggirata qui.
 */
function requireLoanTransaction(transactionId: string): Transaction {
  const transaction = transactionsService.findById(transactionId);
  if (transaction === null) {
    throw new NotFoundError(`Transazione "${transactionId}" non trovata.`);
  }
  if (transaction.type !== 'LOAN') {
    throw new ValidationError(
      'Un prestito può nascere solo da un movimento di tipo prestito: correggi prima la natura del movimento.',
    );
  }

  return transaction;
}

/**
 * La transazione a cui può essere collegata una restituzione.
 *
 * Il tipo non viene vincolato: il collegamento aggiunge significato al
 * movimento, non lo trasforma — un bonifico ricevuto resta un'entrata. Il
 * segno invece conta: una restituzione è denaro rientrato, collegarla ad
 * un'uscita sarebbe un errore di inserimento.
 */
function requireRepaymentTransaction(transactionId: string): Transaction {
  const transaction = transactionsService.findById(transactionId);
  if (transaction === null) {
    throw new NotFoundError(`Transazione "${transactionId}" non trovata.`);
  }
  if (toAmountCents(transaction.amount) <= 0) {
    throw new ValidationError(
      'Una restituzione è denaro rientrato: il movimento collegato deve essere un accredito.',
    );
  }

  return transaction;
}

/**
 * Il tetto di capienza del movimento d'origine.
 *
 * Una sola transazione può finanziare più prestiti — un pagamento che copre
 * l'assicurazione di due persone ne è l'esempio — ma la somma dei crediti non
 * può superare il denaro realmente uscito, altrimenti il prestito diventerebbe
 * una seconda contabilità invece della descrizione di una posizione.
 */
function assertFitsTransaction(
  transaction: Transaction,
  amountCents: number,
  exceptLoanId?: string,
): void {
  const capacity = capacityCents(transaction);
  const allocated = loansRepository.allocatedCentsByTransaction(transaction.id, exceptLoanId);

  if (allocated + amountCents <= capacity) {
    return;
  }

  throw new ValidationError(
    allocated === 0
      ? `L'importo del prestito (${euro(amountCents)}) supera quello del movimento (${euro(capacity)}).`
      : `Del movimento da ${euro(capacity)} sono già attribuiti ${euro(allocated)} ad altri prestiti: restano ${euro(capacity - allocated)}.`,
  );
}

/** L'importo in centesimi di una restituzione o di un prestito, sempre positivo. */
function requirePositiveCents(amount: number, what: string): number {
  const cents = toAmountCents(amount);
  if (cents <= 0) {
    throw new ValidationError(`L'importo ${what} deve essere maggiore di zero.`);
  }

  return cents;
}

function toRepaymentViewModel(
  repayment: LoanRepayment,
  transactions: ReadonlyMap<string, Transaction>,
): LoanRepaymentViewModel {
  const transaction =
    repayment.transactionId === null ? undefined : transactions.get(repayment.transactionId);

  return {
    id: repayment.id,
    loanId: repayment.loanId,
    amount: repayment.amountCents / 100,
    repaymentDate: repayment.repaymentDate,
    note: repayment.note,
    transaction: transaction === undefined ? null : toLinkedTransaction(transaction),
  };
}

/**
 * Come si ripartisce il movimento fra prestiti e spesa propria.
 *
 * La quota non attribuita a nessun prestito non è un residuo contabile: è
 * denaro speso, che entra nelle uscite del mese e nella categoria del
 * movimento. Mostrarla è ciò che rende comprensibile un prestito parziale.
 */
function originSplitOf(origin: Transaction): OriginSplit {
  const capacity = capacityCents(origin);
  const lent = Math.min(loansRepository.allocatedCentsByTransaction(origin.id), capacity);

  return {
    amount: capacity / 100,
    lent: lent / 100,
    ownExpense: (capacity - lent) / 100,
  };
}

/**
 * Il dettaglio di un prestito, ricalcolato dallo stato in archivio.
 *
 * Ogni operazione lo restituisce: chi ha appena registrato una restituzione
 * vede subito il residuo aggiornato, senza doverlo ricalcolare da sé né
 * fidarsi di un valore che potrebbe essere già vecchio.
 */
function detailOf(loanId: string): LoanDetailViewModel {
  const aggregate = requireLoan(loanId);
  const repayments = loansRepository.findRepayments(loanId);

  // Le transazioni collegate sono una manciata: una lettura per riga è
  // sufficiente e non richiede di esporre letture in blocco.
  const linked = new Map<string, Transaction>();
  for (const repayment of repayments) {
    if (repayment.transactionId === null || linked.has(repayment.transactionId)) {
      continue;
    }
    const transaction = transactionsService.findById(repayment.transactionId);
    if (transaction !== null) {
      linked.set(repayment.transactionId, transaction);
    }
  }

  const origin = transactionsService.findById(aggregate.transactionId);
  const split = origin === null ? null : originSplitOf(origin);

  return {
    ...toSummary(aggregate),
    transaction: origin === null ? null : toLinkedTransaction(origin),
    originSplit: split,
    transactionTypeMismatch: origin !== null && origin.type !== 'LOAN',
    repayments: repayments.map((repayment) => toRepaymentViewModel(repayment, linked)),
  };
}

function totalsOf(aggregates: readonly LoanAggregate[]): LoanTotals {
  let lentCents = 0;
  let repaidCents = 0;
  let remaining = 0;
  let openCount = 0;

  for (const aggregate of aggregates) {
    const left = remainingCents(aggregate.amountCents, aggregate.repaidCents);

    lentCents += aggregate.amountCents;
    repaidCents += aggregate.repaidCents;
    remaining += left;
    if (left > 0) {
      openCount += 1;
    }
  }

  return {
    lent: lentCents / 100,
    repaid: repaidCents / 100,
    remaining: remaining / 100,
    openCount,
    loanCount: aggregates.length,
  };
}

/** Servizio pubblico della feature: unico punto di accesso per le altre feature. */
export const loansService = {
  /**
   * I movimenti che hanno prestiti registrati, con quanto è stato attribuito.
   *
   * È ciò che le proiezioni finanziarie — riepilogo, cash flow, analytics,
   * dashboard — usano per ripartire un movimento fra spesa propria e credito.
   * Il dominio dei prestiti dice *quanto* è stato prestato; come si traduce in
   * spesa e patrimonio lo decide la feature `transactions`, che resta l'unica
   * a definire cosa sia una spesa.
   */
  allocations(): LoanAllocation[] {
    return loansRepository.findAllocations();
  },

  /**
   * Quanto è stato attribuito a prestiti, per movimento.
   *
   * Un movimento assente dalla mappa non ha prestiti registrati: vale zero.
   */
  lentCentsByTransaction(): Map<string, number> {
    return new Map(
      loansRepository
        .findAllocations()
        .map((allocation) => [allocation.transactionId, allocation.lentCents]),
    );
  },

  /**
   * I prestiti che soddisfano i criteri, con i totali della posizione.
   *
   * I totali derivano dallo stesso insieme filtrato dell'elenco: i numeri in
   * alto sono la somma delle righe sotto, non un conto separato.
   */
  list(query: LoanQuery): LoanListViewModel {
    const aggregates = loansRepository.findAggregates(query);

    return {
      query,
      totals: totalsOf(aggregates),
      borrowers: loansRepository.distinctBorrowers(),
      items: aggregates.map(toSummary),
    };
  },

  getById(id: string): LoanDetailViewModel {
    return detailOf(id);
  },

  /**
   * L'indice dei movimenti che hanno un prestito dietro.
   *
   * Permette all'esplorazione dei movimenti di proporre l'azione giusta senza
   * che la feature `transactions` sappia cosa sia un prestito.
   */
  links(): LoanLinksViewModel {
    const aggregates = loansRepository.findAggregates(DEFAULT_LOAN_QUERY);
    const byId = new Map(aggregates.map((aggregate) => [aggregate.id, aggregate]));

    const linkOf = (aggregate: LoanAggregate, transactionId: string, role: LoanLink['role']): LoanLink => {
      const remaining = remainingCents(aggregate.amountCents, aggregate.repaidCents);

      return {
        transactionId,
        loanId: aggregate.id,
        role,
        borrowerName: aggregate.borrowerName,
        amount: aggregate.amountCents / 100,
        remainingAmount: remaining / 100,
        status: loanStatus(remaining),
      };
    };

    const links = aggregates.map((aggregate) =>
      linkOf(aggregate, aggregate.transactionId, 'ORIGIN'),
    );

    for (const { loanId, transactionId } of loansRepository.findRepaymentLinks()) {
      const aggregate = byId.get(loanId);
      if (aggregate !== undefined) {
        links.push(linkOf(aggregate, transactionId, 'REPAYMENT'));
      }
    }

    return { links };
  },

  /** Crea il credito nato da un movimento di tipo prestito. */
  create(input: unknown): LoanDetailViewModel {
    const parsed = newLoanSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(firstIssue(parsed.error, 'Dati del prestito non validi.'));
    }

    const amountCents = requirePositiveCents(parsed.data.amount, 'del prestito');
    const transaction = requireLoanTransaction(parsed.data.transactionId);
    assertFitsTransaction(transaction, amountCents);

    const loan: Loan = createLoan({
      transactionId: transaction.id,
      borrowerName: parsed.data.borrowerName,
      description: parsed.data.description,
      amountCents,
      lentAt: parsed.data.lentAt,
    });

    loansRepository.insert(loan);

    return detailOf(loan.id);
  },

  /**
   * Corregge i dati di un prestito.
   *
   * Il movimento d'origine non si cambia: è ciò che lo ha fatto nascere. La
   * natura di quel movimento non viene rivalidata — se nel frattempo è stata
   * corretta, il dettaglio lo segnala invece di bloccare ogni modifica.
   */
  update(id: string, input: unknown): LoanDetailViewModel {
    const aggregate = requireLoan(id);

    const parsed = loanUpdateSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(firstIssue(parsed.error, 'Dati del prestito non validi.'));
    }

    const amountCents =
      parsed.data.amount === undefined
        ? aggregate.amountCents
        : requirePositiveCents(parsed.data.amount, 'del prestito');

    if (amountCents < aggregate.repaidCents) {
      throw new ValidationError(
        `Sono già state registrate restituzioni per ${euro(aggregate.repaidCents)}: il prestito non può valere meno.`,
      );
    }

    if (amountCents !== aggregate.amountCents) {
      const transaction = transactionsService.findById(aggregate.transactionId);
      if (transaction !== null) {
        assertFitsTransaction(transaction, amountCents, id);
      }
    }

    loansRepository.update(id, {
      ...(parsed.data.borrowerName === undefined ? {} : { borrowerName: parsed.data.borrowerName }),
      ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
      ...(parsed.data.lentAt === undefined ? {} : { lentAt: parsed.data.lentAt }),
      amountCents,
    });

    return detailOf(id);
  },

  /**
   * Elimina un prestito registrato per errore.
   *
   * Solo se non ha restituzioni: cancellare anche lo storico di ciò che è
   * rientrato sarebbe una perdita di dati mascherata da correzione. Le
   * restituzioni si eliminano una per una, consapevolmente.
   */
  remove(id: string): void {
    const aggregate = requireLoan(id);

    if (aggregate.repaymentCount > 0) {
      throw new ConflictError(
        `Il prestito ha ${aggregate.repaymentCount} restituzioni registrate: eliminale prima di eliminare il prestito.`,
      );
    }

    loansRepository.delete(id);
  },

  /** Registra una restituzione, bancaria o in contanti. */
  addRepayment(loanId: string, input: unknown): LoanDetailViewModel {
    const aggregate = requireLoan(loanId);

    const parsed = newRepaymentSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(firstIssue(parsed.error, 'Dati della restituzione non validi.'));
    }

    const amountCents = requirePositiveCents(parsed.data.amount, 'della restituzione');
    if (parsed.data.transactionId !== null) {
      requireRepaymentTransaction(parsed.data.transactionId);
    }

    const remaining = remainingCents(aggregate.amountCents, aggregate.repaidCents);
    if (amountCents > remaining) {
      throw new ValidationError(
        remaining === 0
          ? 'Il prestito è già stato restituito per intero.'
          : `La restituzione (${euro(amountCents)}) supera il credito residuo (${euro(remaining)}).`,
      );
    }

    loansRepository.insertRepayment(
      createRepayment({
        loanId,
        transactionId: parsed.data.transactionId,
        amountCents,
        repaymentDate: parsed.data.repaymentDate,
        note: parsed.data.note,
      }),
    );

    return detailOf(loanId);
  },

  /**
   * Corregge una restituzione.
   *
   * Il vincolo guarda il totale: la somma di tutte le restituzioni, questa
   * compresa nel suo nuovo importo, non può superare il prestato.
   */
  updateRepayment(loanId: string, repaymentId: string, input: unknown): LoanDetailViewModel {
    const aggregate = requireLoan(loanId);
    const repayment = requireRepayment(loanId, repaymentId);

    const parsed = repaymentUpdateSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(firstIssue(parsed.error, 'Dati della restituzione non validi.'));
    }

    const amountCents =
      parsed.data.amount === undefined
        ? repayment.amountCents
        : requirePositiveCents(parsed.data.amount, 'della restituzione');

    const others = loansRepository.repaidCents(loanId, repaymentId);
    if (others + amountCents > aggregate.amountCents) {
      throw new ValidationError(
        `Con questa modifica il totale restituito (${euro(others + amountCents)}) supererebbe il prestato (${euro(aggregate.amountCents)}).`,
      );
    }

    if (parsed.data.transactionId !== undefined && parsed.data.transactionId !== null) {
      requireRepaymentTransaction(parsed.data.transactionId);
    }

    loansRepository.updateRepayment(repaymentId, {
      ...(parsed.data.repaymentDate === undefined
        ? {}
        : { repaymentDate: parsed.data.repaymentDate }),
      ...(parsed.data.note === undefined ? {} : { note: parsed.data.note }),
      ...(parsed.data.transactionId === undefined
        ? {}
        : { transactionId: parsed.data.transactionId }),
      amountCents,
    });

    return detailOf(loanId);
  },

  /** Elimina una restituzione: il credito residuo torna a comprenderla. */
  removeRepayment(loanId: string, repaymentId: string): LoanDetailViewModel {
    requireLoan(loanId);
    requireRepayment(loanId, repaymentId);

    loansRepository.deleteRepayment(repaymentId);

    return detailOf(loanId);
  },
};

/** Una restituzione appartenente a quel prestito, altrimenti non esiste. */
function requireRepayment(loanId: string, repaymentId: string): LoanRepayment {
  const repayment = loansRepository.findRepaymentById(repaymentId);
  if (repayment === null || repayment.loanId !== loanId) {
    throw new NotFoundError(`Restituzione "${repaymentId}" non trovata per il prestito "${loanId}".`);
  }

  return repayment;
}
