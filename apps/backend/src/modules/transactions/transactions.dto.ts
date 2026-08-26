import { toMerchantDto, type MerchantDto } from '../merchants/index.js';
import type { TransactionType } from './transaction-type.js';
import type { TransactionPage, TransactionWithMerchant } from './transactions.service.js';

/** Rappresentazione della transazione esposta dalle API. */
export interface TransactionDto {
  id: string;
  bookingDate: string;
  description: string;
  amount: number;
  /** Natura finanziaria del movimento. */
  type: TransactionType;
  merchant: MerchantDto | null;
}

/** Una pagina di transazioni, con le informazioni per navigare fra le altre. */
export interface TransactionPageDto {
  items: TransactionDto[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export function toTransactionDto({ transaction, merchant }: TransactionWithMerchant): TransactionDto {
  return {
    id: transaction.id,
    bookingDate: transaction.bookingDate,
    description: transaction.description,
    amount: transaction.amount,
    type: transaction.type,
    merchant: merchant === null ? null : toMerchantDto(merchant),
  };
}

export function toTransactionPageDto(page: TransactionPage): TransactionPageDto {
  return {
    items: page.transactions.map(toTransactionDto),
    pagination: {
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      totalPages: page.totalPages,
    },
  };
}
