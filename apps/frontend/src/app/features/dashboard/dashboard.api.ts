import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { DashboardFilterState } from './dashboard-filter.store';
import { Dashboard } from './dashboard.model';

@Injectable({ providedIn: 'root' })
export class DashboardApi {
  private readonly http = inject(HttpClient);

  get({ month, type, categoryId, merchantId }: DashboardFilterState): Observable<Dashboard> {
    let params = new HttpParams().set('month', month);
    if (type !== null) {
      params = params.set('type', type);
    }
    if (categoryId !== null) {
      params = params.set('categoryId', categoryId);
    }
    if (merchantId !== null) {
      params = params.set('merchantId', merchantId);
    }

    return this.http.get<Dashboard>(`${API_BASE_URL}/dashboard`, { params });
  }
}
