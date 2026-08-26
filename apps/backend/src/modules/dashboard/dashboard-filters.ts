import {
  transactionTypeSchema,
  type TransactionType,
  type TransactionWithMerchant,
} from '../transactions/index.js';

/**
 * Filtri della dashboard.
 *
 * `null` significa "nessun filtro": è l'unico stato condiviso da tutte le
 * sezioni, così non possono mostrare selezioni diverse.
 */
export interface DashboardFilters {
  type: TransactionType | null;
  categoryId: string | null;
  merchantId: string | null;
}

export const NO_FILTERS: DashboardFilters = { type: null, categoryId: null, merchantId: null };

/** Interpreta i filtri arrivati dalla query string, ignorando i valori vuoti. */
export function parseFilters(raw: {
  type?: string | undefined;
  categoryId?: string | undefined;
  merchantId?: string | undefined;
}): DashboardFilters {
  const type = transactionTypeSchema.safeParse(raw.type);

  return {
    type: type.success ? type.data : null,
    categoryId: raw.categoryId?.trim() || null,
    merchantId: raw.merchantId?.trim() || null,
  };
}

/** Seleziona le transazioni che soddisfano tutti i filtri attivi. */
export function applyFilters(
  entries: readonly TransactionWithMerchant[],
  { type, categoryId, merchantId }: DashboardFilters,
): TransactionWithMerchant[] {
  return entries.filter(({ transaction, merchant }) => {
    if (type !== null && transaction.type !== type) {
      return false;
    }
    if (merchantId !== null && transaction.merchantId !== merchantId) {
      return false;
    }
    if (categoryId !== null && (merchant?.category?.id ?? null) !== categoryId) {
      return false;
    }

    return true;
  });
}
