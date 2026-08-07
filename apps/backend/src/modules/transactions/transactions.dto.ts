import { toMerchantDto, type MerchantDto } from '../merchants/index.js';
import type { TransactionType } from './transaction-type.js';
import type { TransactionWithMerchant } from './transactions.service.js';

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
