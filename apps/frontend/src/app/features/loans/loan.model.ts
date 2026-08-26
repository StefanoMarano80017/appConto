import { TransactionType } from '../transactions/transaction-type';
import { LoanQueryState } from './loan-query';

/**
 * Il dominio dei prestiti così come lo espone il backend.
 *
 * `remainingAmount` e `status` non sono dati memorizzati: il backend li deriva
 * dalle restituzioni ad ogni richiesta. Il frontend li legge e non li ricalcola,
 * così non possono divergere.
 */

/** Aperto finché resta credito da ricevere. */
export type LoanStatus = 'OPEN' | 'SETTLED';

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  OPEN: 'Aperto',
  SETTLED: 'Chiuso'
};

/**
 * Il movimento bancario collegato.
 *
 * L'importo conserva il segno del conto: la transazione che origina un prestito
 * è negativa, quella di una restituzione è positiva.
 */
export interface LinkedTransaction {
  id: string;
  bookingDate: string;
  description: string;
  amount: number;
  type: TransactionType;
}

/** Il prestito come lo mostra la lista. */
export interface LoanSummary {
  id: string;
  transactionId: string;
  borrowerName: string;
  description: string | null;
  lentAt: string;
  /** Importo prestato, sempre positivo. */
  amount: number;
  repaidAmount: number;
  /** `amount - repaidAmount`: quanto resta da ricevere. */
  remainingAmount: number;
  status: LoanStatus;
  repaymentCount: number;
}

/** I totali della posizione di credito, calcolati sull'insieme filtrato. */
export interface LoanTotals {
  lent: number;
  repaid: number;
  remaining: number;
  openCount: number;
  loanCount: number;
}

export interface LoanList {
  query: LoanQueryState;
  totals: LoanTotals;
  /** Le persone in archivio: è il vocabolario del filtro, non dipende dai filtri. */
  borrowers: string[];
  items: LoanSummary[];
}

export interface LoanRepayment {
  id: string;
  loanId: string;
  amount: number;
  repaymentDate: string;
  note: string | null;
  /** `null` quando la restituzione è avvenuta in contanti. */
  transaction: LinkedTransaction | null;
}

/**
 * Come si ripartisce il movimento d'origine.
 *
 * Un pagamento unico può essere due cose insieme: in parte denaro anticipato
 * per qualcun altro, in parte spesa propria. `ownExpense` è la seconda parte, e
 * non è un dettaglio contabile: è quella che entra nelle uscite del mese e nella
 * categoria del movimento.
 */
export interface OriginSplit {
  /** Quanto è uscito dal conto, in valore assoluto. */
  amount: number;
  /** Quanto è attribuito a prestiti, questo compreso. */
  lent: number;
  /** `amount - lent`: quanto resta a carico proprio. */
  ownExpense: number;
}

export interface LoanDetail extends LoanSummary {
  transaction: LinkedTransaction | null;
  /** La ripartizione del movimento d'origine. `null` se il movimento non c'è più. */
  originSplit: OriginSplit | null;
  /** Il movimento d'origine non è più di tipo prestito: vale segnalarlo. */
  transactionTypeMismatch: boolean;
  repayments: LoanRepayment[];
}

/** Il ruolo di un movimento rispetto ad un prestito. */
export type LoanLinkRole = 'ORIGIN' | 'REPAYMENT';

export interface LoanLink {
  transactionId: string;
  loanId: string;
  role: LoanLinkRole;
  borrowerName: string;
  /** Importo del prestito: sommando quelli di un movimento si sa quanto ne resta. */
  amount: number;
  remainingAmount: number;
  status: LoanStatus;
}

export interface LoanLinks {
  links: LoanLink[];
}

/** Corpo della creazione di un prestito. */
export interface NewLoan {
  transactionId: string;
  borrowerName: string;
  description: string | null;
  amount: number;
  lentAt: string;
}

/** Corpo della registrazione di una restituzione. */
export interface NewRepayment {
  amount: number;
  repaymentDate: string;
  note: string | null;
  /** `null` per una restituzione in contanti. */
  transactionId: string | null;
}

/**
 * I legami indicizzati per transazione.
 *
 * Un movimento può originare più prestiti, quindi la chiave porta ad un elenco.
 */
export function indexLinksByTransaction(links: readonly LoanLink[]): Map<string, LoanLink[]> {
  const byTransaction = new Map<string, LoanLink[]>();

  for (const link of links) {
    const existing = byTransaction.get(link.transactionId);
    if (existing === undefined) {
      byTransaction.set(link.transactionId, [link]);
    } else {
      existing.push(link);
    }
  }

  return byTransaction;
}
