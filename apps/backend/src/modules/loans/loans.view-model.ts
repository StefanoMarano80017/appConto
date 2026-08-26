import type { TransactionType } from '../transactions/index.js';
import type { LoanQuery } from './loan-query.js';
import type { LoanStatus } from './loan.model.js';

/**
 * Rappresentazione dei prestiti esposta dalle API.
 *
 * Gli importi sono in euro, sempre calcolati a partire dagli interi in
 * centesimi: la conversione avviene solo qui, ai bordi.
 *
 * `remainingAmount` e `status` compaiono in queste viste ma non esistono in
 * archivio: sono derivati dalle restituzioni ad ogni richiesta, come le altre
 * grandezze calcolate del progetto.
 */

/**
 * Riferimento ad un movimento bancario.
 *
 * Non è il DTO della feature `transactions`: qui serve solo a mostrare quale
 * movimento è collegato, non a rappresentarlo per intero. L'importo conserva
 * il segno del conto, quindi la transazione che origina un prestito è negativa.
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
  /** Movimento bancario che lo ha originato. */
  transactionId: string;
  borrowerName: string;
  description: string | null;
  lentAt: string;
  /** Importo prestato, sempre positivo. */
  amount: number;
  /** Somma delle restituzioni registrate. */
  repaidAmount: number;
  /** `amount - repaidAmount`: quanto resta da ricevere. Mai negativo. */
  remainingAmount: number;
  /** Derivato dal residuo: `OPEN` se resta qualcosa, altrimenti `SETTLED`. */
  status: LoanStatus;
  repaymentCount: number;
}

/**
 * I totali della posizione di credito.
 *
 * Sono calcolati sullo stesso insieme filtrato della lista: i numeri in alto e
 * le righe sotto non possono raccontare cose diverse.
 */
export interface LoanTotals {
  /** Totale prestato. */
  lent: number;
  /** Totale restituito. */
  repaid: number;
  /** Credito ancora da ricevere. */
  remaining: number;
  /** Prestiti con residuo maggiore di zero. */
  openCount: number;
  loanCount: number;
}

export interface LoanListViewModel {
  /** I criteri applicati, così come li ha interpretati il backend. */
  query: LoanQuery;
  totals: LoanTotals;
  /**
   * Le persone presenti in archivio, indipendentemente dai filtri attivi.
   *
   * È il vocabolario del filtro per persona, non un dato dell'analisi: come
   * l'elenco delle categorie per l'esplorazione dei movimenti.
   */
  borrowers: string[];
  items: LoanSummary[];
}

/** Una restituzione, con il movimento a cui è collegata se ne ha uno. */
export interface LoanRepaymentViewModel {
  id: string;
  loanId: string;
  /** Importo restituito, sempre positivo. */
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

export interface LoanDetailViewModel extends LoanSummary {
  /** La transazione d'origine. `null` solo se è stata rimossa dall'archivio. */
  transaction: LinkedTransaction | null;
  /** La ripartizione del movimento d'origine. `null` se il movimento non c'è più. */
  originSplit: OriginSplit | null;
  /**
   * La transazione d'origine non è più di tipo `LOAN`.
   *
   * Succede se il tipo viene corretto dopo la creazione del prestito. Il
   * prestito resta valido — importo e data sono suoi — ma vale segnalarlo,
   * perché uno dei due dati è da sistemare.
   */
  transactionTypeMismatch: boolean;
  /** Storico delle restituzioni, dalla più recente. */
  repayments: LoanRepaymentViewModel[];
}

/** Il ruolo che un movimento bancario ha rispetto ad un prestito. */
export type LoanLinkRole = 'ORIGIN' | 'REPAYMENT';

/**
 * Il legame fra un movimento ed un prestito.
 *
 * È l'indice che permette all'esplorazione dei movimenti di mostrare «apri
 * prestito» o «restituzione prestito» senza che la feature `transactions`
 * debba conoscere il dominio dei prestiti: la dipendenza resta in un solo
 * verso, `loans → transactions`.
 */
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

export interface LoanLinksViewModel {
  /** Un movimento può comparire più volte: una transazione può originare più prestiti. */
  links: LoanLink[];
}
