import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { categoriesService, type Category } from '../categories/index.js';
import { transactionsService } from '../transactions/index.js';
import { merchantLabel, type Merchant } from './merchant.model.js';
import type { MerchantQuery, MerchantSortField } from './merchant-query.js';
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

/** Quanti merchant ci sono in archivio, in totale e per stato di classificazione. */
export interface MerchantCounts {
  all: number;
  classified: number;
  unclassified: number;
}

/** Una pagina di merchant con i totali delle transazioni. */
export interface MerchantPage {
  summaries: MerchantSummary[];
  page: number;
  pageSize: number;
  /** Merchant che soddisfano ricerca e filtro, su tutte le pagine. */
  total: number;
  totalPages: number;
  counts: MerchantCounts;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'it', { sensitivity: 'base' });
}

/**
 * Confronto per campo, in ordine crescente. I `null` non passano di qui: li
 * sistema `compareBy`, perché devono restare in fondo in entrambe le direzioni.
 */
const SORT_VALUES: Record<MerchantSortField, (summary: MerchantSummary) => string | number | null> = {
  name: (s) => merchantLabel(s.merchant),
  category: (s) => s.category?.name ?? null,
  transactionCount: (s) => s.transactionCount,
  totalSpent: (s) => s.totalSpent,
  lastTransactionDate: (s) => s.lastTransactionDate,
};

function compareBy(query: MerchantQuery): (a: MerchantSummary, b: MerchantSummary) => number {
  const valueOf = SORT_VALUES[query.sortBy];
  const sign = query.sortDirection === 'asc' ? 1 : -1;

  return (a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);

    // i valori assenti vanno in fondo prima di applicare la direzione
    if (left === null || right === null) {
      if (left !== right) {
        return left === null ? 1 : -1;
      }
    } else {
      const order =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : compareText(String(left), String(right));
      if (order !== 0) {
        return order * sign;
      }
    }

    // a parità il nome cresce sempre, così l'ordine non dipende dall'archivio
    return compareText(merchantLabel(a.merchant), merchantLabel(b.merchant));
  };
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
   * Una pagina di merchant filtrata, cercata e ordinata secondo `query`.
   *
   * I `counts` riguardano l'intero archivio: servono alle schede del filtro, che
   * non devono cambiare mentre si scrive nella ricerca.
   *
   * Una pagina oltre l'ultima NON viene riportata all'ultima, a differenza di
   * `transactionsService.search`: così il chiamante vede la paginazione reale
   * (`total`, `totalPages`) e decide lui cosa fare con una pagina svuotata.
   */
  search(query: MerchantQuery): MerchantPage {
    const all = this.listSummaries();
    const counts: MerchantCounts = {
      all: all.length,
      classified: all.filter((s) => s.category !== null).length,
      unclassified: all.filter((s) => s.category === null).length,
    };

    const needle = query.search?.toLowerCase() ?? null;
    const matching = all
      .filter((s) => {
        if (query.classification === 'classified') return s.category !== null;
        if (query.classification === 'unclassified') return s.category === null;
        return true;
      })
      .filter(
        (s) =>
          needle === null ||
          merchantLabel(s.merchant).toLowerCase().includes(needle) ||
          s.merchant.name.toLowerCase().includes(needle),
      )
      .sort(compareBy(query));

    const start = (query.page - 1) * query.pageSize;

    return {
      summaries: matching.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total: matching.length,
      totalPages: Math.max(Math.ceil(matching.length / query.pageSize), 1),
      counts,
    };
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
