import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { Merchant, MerchantSummary } from './merchant.model';

@Injectable({ providedIn: 'root' })
export class MerchantsApi {
  private readonly http = inject(HttpClient);

  /** I merchant con i totali delle transazioni, dal più speso al meno speso. */
  summary(): Observable<MerchantSummary[]> {
    return this.http.get<MerchantSummary[]>(`${API_BASE_URL}/merchants/summary`);
  }

  /** Assegna la categoria al merchant; `null` la rimuove. */
  updateCategory(merchantId: string, categoryId: string | null): Observable<Merchant> {
    return this.http.patch<Merchant>(`${API_BASE_URL}/merchants/${merchantId}/category`, {
      categoryId
    });
  }

  /** Rinomina il merchant; una stringa vuota ripristina il nome della banca. */
  updateDisplayName(merchantId: string, displayName: string): Observable<Merchant> {
    return this.http.patch<Merchant>(`${API_BASE_URL}/merchants/${merchantId}`, { displayName });
  }
}
