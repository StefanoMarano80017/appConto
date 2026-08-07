import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatAmount, formatBookingDate } from '../../core/format';
import { toErrorMessage } from '../../core/http-error';
import { CategoriesApi } from '../categories/categories.api';
import { Category } from '../categories/category.model';
import { Merchant } from '../merchants/merchant.model';
import { MerchantsApi } from '../merchants/merchants.api';
import {
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABELS,
  TransactionType,
  isSpending
} from './transaction-type';
import { Transaction } from './transaction.model';
import { TransactionsApi } from './transactions.api';

@Component({
  selector: 'app-transactions-page',
  imports: [FormsModule],
  templateUrl: './transactions-page.html',
  styleUrl: './transactions-page.scss'
})
export class TransactionsPage implements OnInit {
  private readonly api = inject(TransactionsApi);
  private readonly categoriesApi = inject(CategoriesApi);
  private readonly merchantsApi = inject(MerchantsApi);

  protected readonly transactions = signal<Transaction[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Merchant con una modifica di categoria in corso. */
  protected readonly savingMerchantId = signal<string | null>(null);
  /** Transazione con una modifica di tipo in corso. */
  protected readonly savingTransactionId = signal<string | null>(null);

  protected readonly transactionTypes = TRANSACTION_TYPES;
  protected readonly typeLabels = TRANSACTION_TYPE_LABELS;
  protected readonly isSpending = isSpending;
  protected readonly formatAmount = formatAmount;
  protected readonly formatBookingDate = formatBookingDate;

  ngOnInit(): void {
    this.categoriesApi.list().subscribe({
      next: (categories) => this.categories.set(categories),
      error: (error: unknown) => this.error.set(toErrorMessage(error))
    });

    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.list().subscribe({
      next: (transactions) => {
        this.transactions.set(transactions);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.loading.set(false);
      }
    });
  }

  /**
   * Corregge la natura del movimento: riguarda la singola transazione,
   * non il merchant.
   */
  protected changeType(transaction: Transaction, type: TransactionType): void {
    if (transaction.type === type) {
      return;
    }

    this.savingTransactionId.set(transaction.id);
    this.error.set(null);

    this.api.updateType(transaction.id, type).subscribe({
      next: (updated) => {
        this.transactions.update((transactions) =>
          transactions.map((current) =>
            current.id === updated.id ? { ...current, type: updated.type } : current
          )
        );
        this.savingTransactionId.set(null);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.savingTransactionId.set(null);
        this.load(); // ripristina lo stato mostrato a video
      }
    });
  }

  /**
   * Cambia la categoria del merchant: tutte le transazioni dello stesso
   * esercente ereditano immediatamente la nuova categoria.
   */
  protected changeCategory(merchant: Merchant, selectedId: string): void {
    const categoryId = selectedId === '' ? null : selectedId;
    if ((merchant.category?.id ?? null) === categoryId) {
      return;
    }

    this.savingMerchantId.set(merchant.id);
    this.error.set(null);

    this.merchantsApi.updateCategory(merchant.id, categoryId).subscribe({
      next: (updated) => {
        this.transactions.update((transactions) =>
          transactions.map((transaction) =>
            transaction.merchant?.id === updated.id
              ? { ...transaction, merchant: updated }
              : transaction
          )
        );
        this.savingMerchantId.set(null);
      },
      error: (error: unknown) => {
        this.error.set(toErrorMessage(error));
        this.savingMerchantId.set(null);
        this.load(); // ripristina lo stato mostrato a video
      }
    });
  }
}
