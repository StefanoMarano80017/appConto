import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { loansService } from '../loans/index.js';
import {
  expenseCents,
  hasExpense,
  isIncome,
  toAmountCents,
  transactionsService,
  type TransactionWithMerchant,
} from '../transactions/index.js';
import type { CategorySummary, SummaryViewModel } from './summary.view-model.js';

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Accumulatore in centesimi: le somme restano esatte. */
interface CategoryTotal {
  id: string;
  name: string;
  color: string | null;
  amountCents: number;
  transactionCount: number;
}

/**
 * Aggrega un insieme di transazioni già selezionato.
 *
 * È una funzione pura ed esportata perché anche la dashboard deve riepilogare
 * un sottoinsieme filtrato: qui vive l'unica definizione di "entrate" e
 * "uscite" del mese, e non può quindi divergere fra le due viste.
 *
 * @param lentByTransaction quanto di ciascun movimento è stato attribuito a
 *        prestiti. Serve a ripartire un movimento di tipo prestito fra la quota
 *        prestata — che è credito — e il resto, che è spesa propria.
 */
export function summarizeEntries(
  month: string,
  entries: readonly TransactionWithMerchant[],
  lentByTransaction: ReadonlyMap<string, number> = new Map(),
): SummaryViewModel {
  let incomeCents = 0;
  let expensesCents = 0;
  let uncategorizedCents = 0;
  let uncategorizedCount = 0;
  const merchantIds = new Set<string>();
  const totalsByCategory = new Map<string, CategoryTotal>();

  for (const { transaction, merchant } of entries) {
    const amountCents = toAmountCents(transaction.amount);

    if (transaction.merchantId !== null) {
      merchantIds.add(transaction.merchantId);
    }

    if (isIncome(transaction.type)) {
      incomeCents += amountCents;
      continue;
    }

    const lentCents = lentByTransaction.get(transaction.id) ?? 0;

    // Prelievi e trasferimenti non sono spese, e nemmeno la quota di un
    // prestito che è diventata credito: restano fuori dai totali e dalle
    // categorie, pur comparendo nel cash flow. Di un pagamento in parte
    // prestato entra invece la quota rimasta a carico proprio.
    if (!hasExpense(transaction.type, amountCents, lentCents)) {
      continue;
    }

    const expense = expenseCents(transaction.type, amountCents, lentCents);
    expensesCents += expense;

    const category = merchant?.category ?? null;
    if (category === null) {
      uncategorizedCents += expense;
      uncategorizedCount += 1;
      continue;
    }

    const total = totalsByCategory.get(category.id) ?? {
      id: category.id,
      name: category.name,
      color: category.color,
      amountCents: 0,
      transactionCount: 0,
    };
    total.amountCents += expense;
    total.transactionCount += 1;
    totalsByCategory.set(category.id, total);
  }

  const amountByCategory: CategorySummary[] = [...totalsByCategory.values()]
    .map(({ amountCents, ...category }) => ({ ...category, amount: amountCents / 100 }))
    .sort((a, b) => b.amount - a.amount);

  return {
    month,
    income: incomeCents / 100,
    expenses: expensesCents / 100,
    balance: (incomeCents - expensesCents) / 100,
    transactionCount: entries.length,
    merchantCount: merchantIds.size,
    amountByCategory,
    uncategorized: {
      amount: uncategorizedCents / 100,
      transactionCount: uncategorizedCount,
    },
  };
}

/** Valida un mese in formato `YYYY-MM`, sollevando un errore di dominio. */
export function requireMonth(month: string): string {
  const parsed = monthSchema.safeParse(month);
  if (!parsed.success) {
    throw new ValidationError('Il mese deve essere indicato nel formato YYYY-MM.');
  }

  return parsed.data;
}

/**
 * Caso d'uso "riepilogo del mese".
 *
 * Non possiede dati propri: interroga la feature `transactions` attraverso il
 * suo servizio pubblico e aggrega. Il risultato è sempre ricalcolato, mai
 * memorizzato, così non può divergere dalle transazioni.
 */
export const summaryService = {
  getMonthlySummary(month: string): SummaryViewModel {
    const validMonth = requireMonth(month);

    return summarizeEntries(
      validMonth,
      transactionsService.listByMonthWithMerchant(validMonth),
      loansService.lentCentsByTransaction(),
    );
  },
};
