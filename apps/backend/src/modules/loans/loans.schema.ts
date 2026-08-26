import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { transactions } from '../transactions/transactions.schema.js';

/**
 * Tabelle SQLite del dominio dei prestiti.
 *
 * Sono separate da `transactions` perché rappresentano un'altra cosa: la
 * transazione dice cosa è successo sul conto, il prestito dice quanto denaro
 * si attende indietro. Nessun importo della transazione viene ricopiato qui
 * per farne contabilità: `amount_cents` è l'importo *del prestito*, che può
 * essere una parte del movimento che lo ha originato.
 *
 * Non esistono colonne per il credito residuo né per lo stato: entrambi si
 * derivano dalle restituzioni, così non possono divergere da esse.
 *
 * `transactions` viene importato solo per dichiarare il vincolo di integrità
 * referenziale: a runtime il repository interroga solo queste due tabelle e la
 * transazione collegata.
 */
export const loans = sqliteTable(
  'loans',
  {
    id: text('id').primaryKey(),
    /** Movimento bancario che ha originato il credito. Deve essere di tipo `LOAN`. */
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id),
    /** Nome della persona, così come lo scrive l'utente: non esiste un'anagrafica. */
    borrowerName: text('borrower_name').notNull(),
    description: text('description'),
    /** Sempre positivo: il prestito è una somma anticipata, non un movimento. */
    amountCents: integer('amount_cents').notNull(),
    lentAt: text('lent_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('loans_transaction_id_idx').on(table.transactionId)],
);

/**
 * Restituzione di una parte (o di tutto) il prestito.
 *
 * `transaction_id` è opzionale: una restituzione in contanti non ha alcun
 * movimento bancario e non deve inventarne uno. Quando c'è, il collegamento
 * aggiunge significato al movimento senza modificarlo: la transazione resta
 * l'entrata che è.
 *
 * Non c'è `ON DELETE CASCADE`: cancellare un prestito che ha restituzioni deve
 * essere impossibile, non silenzioso.
 */
export const loanRepayments = sqliteTable(
  'loan_repayments',
  {
    id: text('id').primaryKey(),
    loanId: text('loan_id')
      .notNull()
      .references(() => loans.id),
    transactionId: text('transaction_id').references(() => transactions.id),
    /** Sempre positivo: una restituzione riduce il credito. */
    amountCents: integer('amount_cents').notNull(),
    repaymentDate: text('repayment_date').notNull(),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('loan_repayments_loan_id_idx').on(table.loanId),
    index('loan_repayments_transaction_id_idx').on(table.transactionId),
  ],
);
