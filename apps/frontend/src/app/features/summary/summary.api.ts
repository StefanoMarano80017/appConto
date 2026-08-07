import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { Summary } from './summary.model';

@Injectable({ providedIn: 'root' })
export class SummaryApi {
  private readonly http = inject(HttpClient);

  /** @param month mese in formato `YYYY-MM` */
  get(month: string): Observable<Summary> {
    return this.http.get<Summary>(`${API_BASE_URL}/summary`, {
      params: new HttpParams().set('month', month)
    });
  }
}
