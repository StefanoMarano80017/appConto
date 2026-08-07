import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { TransactionType } from './transaction-type';
import { Transaction } from './transaction.model';

@Injectable({ providedIn: 'root' })
export class TransactionsApi {
  private readonly http = inject(HttpClient);

  list(): Observable<Transaction[]> {
    return this.http.get<Transaction[]>(`${API_BASE_URL}/transactions`);
  }

  /** Corregge la natura del movimento. */
  updateType(
    transactionId: string,
    type: TransactionType
  ): Observable<{ id: string; type: TransactionType }> {
    return this.http.patch<{ id: string; type: TransactionType }>(
      `${API_BASE_URL}/transactions/${transactionId}/type`,
      { type }
    );
  }
}
