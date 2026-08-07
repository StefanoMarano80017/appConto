import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { CashFlow } from './cash-flow.model';

@Injectable({ providedIn: 'root' })
export class CashFlowApi {
  private readonly http = inject(HttpClient);

  /** @param month mese in formato `YYYY-MM` */
  get(month: string): Observable<CashFlow> {
    return this.http.get<CashFlow>(`${API_BASE_URL}/cash-flow`, {
      params: new HttpParams().set('month', month)
    });
  }
}
