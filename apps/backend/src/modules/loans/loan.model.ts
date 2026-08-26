import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Modello di dominio dei prestiti.
 *
 * Non dipende da Express né da SQLite. Le due entità hanno responsabilità
 * distinte e complementari:
 *
 *   Transaction   ciò che è successo sul conto
 *   Loan          il credito nato da quel movimento
 *   LoanRepayment la riduzione di quel credito
 *
 * Il credito residuo non è un campo: è la differenza fra il prestato e la
 * somma delle restituzioni. Una sola definizione, in un solo posto.
 */

/** Stato del prestito. Non è persistito: è il residuo a determinarlo. */
export type LoanStatus = 'OPEN' | 'SETTLED';

/** Prestito persistito. */
export interface Loan {
  id: string;
  /** Transazione `LOAN` che ha originato il credito. */
  transactionId: string;
  borrowerName: string;
  description: string | null;
  /** Importo del prestito in centesimi, sempre positivo. */
  amountCents: number;
  /** Data del prestito, in formato ISO `YYYY-MM-DD`. */
  lentAt: string;
  /** Istante di registrazione, in formato ISO. */
  createdAt: string;
}

/** Restituzione persistita. */
export interface LoanRepayment {
  id: string;
  loanId: string;
  /** `null` per una restituzione in contanti: nessun movimento bancario esiste. */
  transactionId: string | null;
  /** Importo restituito in centesimi, sempre positivo. */
  amountCents: number;
  repaymentDate: string;
  note: string | null;
  createdAt: string;
}

/**
 * Credito ancora da ricevere.
 *
 * Il risultato non scende sotto zero: le regole di dominio rifiutano una
 * restituzione che superi il residuo, quindi un valore negativo sarebbe un
 * dato incoerente, non un debito al contrario.
 */
export function remainingCents(amountCents: number, repaidCents: number): number {
  return Math.max(amountCents - repaidCents, 0);
}

/** Lo stato è una lettura del residuo, non un dato a sé. */
export function loanStatus(remaining: number): LoanStatus {
  return remaining > 0 ? 'OPEN' : 'SETTLED';
}

/** Una stringa vuota non è un valore: è l'assenza del dato. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value));

/** Importo in euro come arriva dall'API: la conversione in centesimi è del servizio. */
const amountSchema = z
  .number({ error: 'Importo non valido' })
  .finite({ error: 'Importo non valido' });

export const newLoanSchema = z.object({
  transactionId: z.string().trim().min(1, { error: 'Transazione mancante' }),
  borrowerName: z.string().trim().min(1, { error: 'Persona mancante' }).max(120),
  description: optionalText(500),
  amount: amountSchema,
  lentAt: z.iso.date({ error: 'Data del prestito non valida' }),
});

export type NewLoanInput = z.infer<typeof newLoanSchema>;

/** Aggiornamento parziale: la transazione d'origine non si cambia. */
export const loanUpdateSchema = z
  .object({
    borrowerName: z.string().trim().min(1, { error: 'Persona mancante' }).max(120).optional(),
    description: optionalText(500).optional(),
    amount: amountSchema.optional(),
    lentAt: z.iso.date({ error: 'Data del prestito non valida' }).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: 'Nessun campo da aggiornare' });

export type LoanUpdateInput = z.infer<typeof loanUpdateSchema>;

export const newRepaymentSchema = z.object({
  amount: amountSchema,
  repaymentDate: z.iso.date({ error: 'Data della restituzione non valida' }),
  note: optionalText(500),
  /** `null` o assente: restituzione in contanti. */
  transactionId: z
    .string()
    .trim()
    .min(1)
    .nullish()
    .transform((value) => value ?? null),
});

export type NewRepaymentInput = z.infer<typeof newRepaymentSchema>;

export const repaymentUpdateSchema = z
  .object({
    amount: amountSchema.optional(),
    repaymentDate: z.iso.date({ error: 'Data della restituzione non valida' }).optional(),
    note: optionalText(500).optional(),
    transactionId: z
      .string()
      .trim()
      .min(1)
      .nullable()
      .optional()
      .transform((value) => value),
  })
  .refine((value) => Object.keys(value).length > 0, { error: 'Nessun campo da aggiornare' });

export type RepaymentUpdateInput = z.infer<typeof repaymentUpdateSchema>;

export function createLoan(input: Omit<Loan, 'id' | 'createdAt'>): Loan {
  return { id: randomUUID(), ...input, createdAt: new Date().toISOString() };
}

export function createRepayment(input: Omit<LoanRepayment, 'id' | 'createdAt'>): LoanRepayment {
  return { id: randomUUID(), ...input, createdAt: new Date().toISOString() };
}
