import { parseAmount } from '../../core/amount';
import { NewLoan, NewRepayment } from './loan.model';

/**
 * Validazione dei moduli dei prestiti.
 *
 * Sono funzioni pure: nessun accesso alla rete, nessun segnale, nessun
 * componente. Il backend resta l'ultima parola — è lui a conoscere il credito
 * residuo esatto e la capienza rimasta sul movimento — ma un errore evidente
 * non deve richiedere un viaggio fino al server per essere segnalato.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Valori così come li digita l'utente. */
export interface LoanFormValue {
  borrowerName: string;
  description: string;
  amount: string;
  lentAt: string;
}

export interface LoanFormErrors {
  borrowerName?: string;
  amount?: string;
  lentAt?: string;
}

export type LoanFormResult =
  | { valid: true; loan: Omit<NewLoan, 'transactionId'> }
  | { valid: false; errors: LoanFormErrors };

/**
 * @param maxAmount importo del movimento d'origine, in valore assoluto.
 *                  Il prestito può descriverne una parte, mai più di quanto è
 *                  uscito dal conto.
 */
export function validateLoanForm(
  { borrowerName, description, amount, lentAt }: LoanFormValue,
  maxAmount?: number
): LoanFormResult {
  const errors: LoanFormErrors = {};

  const person = borrowerName.trim();
  if (person === '') {
    errors.borrowerName = 'Indica a chi hai prestato il denaro.';
  }

  const value = parseAmount(amount);
  if (amount.trim() === '') {
    errors.amount = "Indica l'importo prestato.";
  } else if (value === null) {
    errors.amount = "L'importo deve essere numerico.";
  } else if (value <= 0) {
    errors.amount = "L'importo prestato deve essere maggiore di zero.";
  } else if (maxAmount !== undefined && value > maxAmount) {
    errors.amount = `Il movimento è di ${maxAmount.toFixed(2).replace('.', ',')} €: il prestito non può valere di più.`;
  }

  const date = lentAt.trim();
  if (date === '') {
    errors.lentAt = 'Indica la data del prestito.';
  } else if (!DATE_PATTERN.test(date)) {
    errors.lentAt = 'La data deve essere nel formato AAAA-MM-GG.';
  }

  if (Object.keys(errors).length > 0 || value === null) {
    return { valid: false, errors };
  }

  const note = description.trim();

  return {
    valid: true,
    loan: {
      borrowerName: person,
      description: note === '' ? null : note,
      amount: value,
      lentAt: date
    }
  };
}

export interface RepaymentFormValue {
  amount: string;
  repaymentDate: string;
  note: string;
  /** Stringa vuota = restituzione in contanti. */
  transactionId: string;
}

export interface RepaymentFormErrors {
  amount?: string;
  repaymentDate?: string;
}

export type RepaymentFormResult =
  | { valid: true; repayment: NewRepayment }
  | { valid: false; errors: RepaymentFormErrors };

/**
 * @param remainingAmount credito residuo: una restituzione non può superarlo.
 */
export function validateRepaymentForm(
  { amount, repaymentDate, note, transactionId }: RepaymentFormValue,
  remainingAmount: number
): RepaymentFormResult {
  const errors: RepaymentFormErrors = {};

  const value = parseAmount(amount);
  if (amount.trim() === '') {
    errors.amount = "Indica l'importo restituito.";
  } else if (value === null) {
    errors.amount = "L'importo deve essere numerico.";
  } else if (value <= 0) {
    errors.amount = 'La restituzione deve essere maggiore di zero.';
  } else if (value > remainingAmount) {
    errors.amount =
      remainingAmount === 0
        ? 'Il prestito è già stato restituito per intero.'
        : `Restano da ricevere ${remainingAmount.toFixed(2).replace('.', ',')} €.`;
  }

  const date = repaymentDate.trim();
  if (date === '') {
    errors.repaymentDate = 'Indica la data della restituzione.';
  } else if (!DATE_PATTERN.test(date)) {
    errors.repaymentDate = 'La data deve essere nel formato AAAA-MM-GG.';
  }

  if (Object.keys(errors).length > 0 || value === null) {
    return { valid: false, errors };
  }

  const text = note.trim();

  return {
    valid: true,
    repayment: {
      amount: value,
      repaymentDate: date,
      note: text === '' ? null : text,
      transactionId: transactionId === '' ? null : transactionId
    }
  };
}
