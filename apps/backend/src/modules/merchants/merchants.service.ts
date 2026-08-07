import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { categoriesService, type Category } from '../categories/index.js';
import { transactionsService } from '../transactions/index.js';
import type { Merchant } from './merchant.model.js';
import { merchantsRepository } from './merchants.repository.js';

/** Merchant con la categoria a cui è associato. */
export interface MerchantWithCategory {
  merchant: Merchant;
  category: Category | null;
}

/**
 * Merchant con i totali delle sue transazioni.
 *
 * I valori aggregati non esistono in archivio: sono richiesti alla feature
 * `transactions` attraverso il suo servizio pubblico ad ogni chiamata.
 */
export interface MerchantSummary extends MerchantWithCategory {
  transactionCount: number;
  totalSpent: number;
  lastTransactionDate: string | null;
}

function listAllWithCategory(): MerchantWithCategory[] {
  const categoriesById = new Map(
    categoriesService.listAll().map((category) => [category.id, category]),
  );

  return merchantsRepository.findAll().map((merchant) => ({
    merchant,
    category:
      merchant.categoryId === null ? null : (categoriesById.get(merchant.categoryId) ?? null),
  }));
}

function requireMerchant(id: string): Merchant {
  const merchant = merchantsRepository.findById(id);
  if (merchant === null) {
    throw new NotFoundError(`Merchant "${id}" non trovato.`);
  }

  return merchant;
}

/** Servizio pubblico della feature: unico punto di accesso per le altre feature. */
export const merchantsService = {
  listAll(): Merchant[] {
    return merchantsRepository.findAll();
  },

  /** I merchant arricchiti con la categoria, letta dalla feature `categories`. */
  listAllWithCategory,

  /**
   * I merchant con i totali delle transazioni, dal più speso al meno speso:
   * l'ordine mette davanti i merchant che vale la pena classificare per primi.
   */
  listSummaries(): MerchantSummary[] {
    const statsByMerchant = transactionsService.statsByMerchant();

    return listAllWithCategory()
      .map((entry) => {
        const stats = statsByMerchant.get(entry.merchant.id);

        return {
          ...entry,
          transactionCount: stats?.transactionCount ?? 0,
          totalSpent: stats?.totalSpent ?? 0,
          lastTransactionDate: stats?.lastTransactionDate ?? null,
        };
      })
      .sort((a, b) => b.totalSpent - a.totalSpent);
  },

  /**
   * Assegna (o rimuove, con `null`) la categoria di un merchant.
   *
   * Le transazioni non vengono toccate: ereditano la categoria dal merchant.
   */
  assignCategory(merchantId: string, categoryId: string | null): MerchantWithCategory {
    const merchant = requireMerchant(merchantId);

    let category: Category | null = null;
    if (categoryId !== null) {
      category = categoriesService.findById(categoryId);
      if (category === null) {
        throw new ValidationError(`Categoria "${categoryId}" inesistente.`);
      }
    }

    merchantsRepository.updateCategory(merchantId, categoryId);

    return { merchant: { ...merchant, categoryId }, category };
  },

  /**
   * Rinomina un merchant. `null` (o una stringa vuota) ripristina il nome
   * originale della banca, che non viene mai modificato.
   *
   * Non tocca la categoria: le due modifiche sono indipendenti.
   */
  updateDisplayName(merchantId: string, displayName: string | null): MerchantWithCategory {
    const merchant = requireMerchant(merchantId);

    const trimmed = displayName === null ? null : displayName.trim();
    const nextDisplayName = trimmed === null || trimmed.length === 0 ? null : trimmed;

    merchantsRepository.updateDisplayName(merchantId, nextDisplayName);

    return {
      merchant: { ...merchant, displayName: nextDisplayName },
      category:
        merchant.categoryId === null ? null : categoriesService.findById(merchant.categoryId),
    };
  },
};
