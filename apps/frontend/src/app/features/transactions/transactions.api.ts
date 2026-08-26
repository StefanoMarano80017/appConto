import { HttpClient, HttpParams, HttpResourceRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { Transaction, TransactionPage } from './transaction.model';
import { TransactionQueryState, toQueryParams } from './transaction-query';
import { TransactionType } from './transaction-type';

/**
 * La richiesta corrispondente ai criteri correnti.
 *
 * Usa la stessa serializzazione dell'URL: ciò che si legge nell'indirizzo è
 * esattamente ciò che viene chiesto al backend.
 */
export function transactionsRequest(state: TransactionQueryState): HttpResourceRequest {
  let params = new HttpParams();

  for (const [name, value] of Object.entries(toQueryParams(state))) {
    if (value !== null && value !== undefined) {
      params = params.set(name, String(value));
    }
  }

  return { url: `${API_BASE_URL}/transactions`, params };
}

@Injectable({ providedIn: 'root' })
export class TransactionsApi {
  private readonly http = inject(HttpClient);

  /** Una pagina di movimenti che soddisfano i criteri. */
  search(state: TransactionQueryState): Observable<TransactionPage> {
    const request = transactionsRequest(state);

    return this.http.get<TransactionPage>(request.url, { params: request.params });
  }

  /** Una singola transazione, con il proprio merchant. */
  get(transactionId: string): Observable<Transaction> {
    return this.http.get<Transaction>(`${API_BASE_URL}/transactions/${transactionId}`);
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
