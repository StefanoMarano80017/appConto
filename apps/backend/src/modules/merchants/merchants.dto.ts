import { toCategoryDto, type CategoryDto } from '../categories/index.js';
import { merchantLabel } from './merchant.model.js';
import type { MerchantSummary, MerchantWithCategory } from './merchants.service.js';

/** Rappresentazione del merchant esposta dalle API. */
export interface MerchantDto {
  id: string;
  /** Nome originale della banca. */
  name: string;
  /** Nome scelto dall'utente, se presente. */
  displayName: string | null;
  /** Nome da mostrare: `displayName` se valorizzato, altrimenti `name`. */
  label: string;
  normalizedName: string;
  category: CategoryDto | null;
}

/** Merchant con i totali delle sue transazioni. */
export interface MerchantSummaryDto extends MerchantDto {
  transactionCount: number;
  /** Somma delle sole uscite, in valore assoluto. */
  totalSpent: number;
  /** Data contabile dell'ultima transazione, in formato ISO `YYYY-MM-DD`. */
  lastTransactionDate: string | null;
}

export function toMerchantDto({ merchant, category }: MerchantWithCategory): MerchantDto {
  return {
    id: merchant.id,
    name: merchant.name,
    displayName: merchant.displayName,
    label: merchantLabel(merchant),
    normalizedName: merchant.normalizedName,
    category: category === null ? null : toCategoryDto(category),
  };
}

export function toMerchantSummaryDto(summary: MerchantSummary): MerchantSummaryDto {
  return {
    ...toMerchantDto(summary),
    transactionCount: summary.transactionCount,
    totalSpent: summary.totalSpent,
    lastTransactionDate: summary.lastTransactionDate,
  };
}
