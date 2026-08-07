import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { isExpense, isIncome, toAmountCents, transactionsService } from '../transactions/index.js';
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
 * Caso d'uso "riepilogo del mese".
 *
 * Non possiede dati propri: interroga la feature `transactions` attraverso il
 * suo servizio pubblico e aggrega. Il risultato è sempre ricalcolato, mai
 * memorizzato, così non può divergere dalle transazioni.
 */
/**
 * Aggrega un insieme di transazioni già selezionato.
 *
 * È esposta come funzione pura perché anche la dashboard deve poter riepilogare
 * un sottoinsieme filtrato senza duplicare le regole: qui vive l'unica
 * definizione di "entrate" e "uscite" del mese.
 */
export function summarizeEntries(
  month: string,
  entries: readonly TransactionWithMerchant[],
): SummaryViewModel {
  {
    {
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

      // Prelievi, trasferimenti e prestiti non sono spese: restano fuori dai
      // totali e dalle categorie, pur comparendo nel cash flow.
      if (!isExpense(transaction.type)) {
        continue;
      }

      const expenseCents = -amountCents;
      expensesCents += expenseCents;

      const category = merchant?.category ?? null;
      if (category === null) {
        uncategorizedCents += expenseCents;
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
      total.amountCents += expenseCents;
      total.transactionCount += 1;
      totalsByCategory.set(category.id, total);
    }

    const amountByCategory: CategorySummary[] = [...totalsByCategory.values()]
      .map(({ amountCents, ...category }) => ({ ...category, amount: amountCents / 100 }))
      .sort((a, b) => b.amount - a.amount);

    return {
      month: parsedMonth.data,
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
  },
};
