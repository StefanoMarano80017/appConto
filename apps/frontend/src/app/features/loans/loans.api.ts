import { HttpClient, HttpParams, HttpResourceRequest } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { LoanQueryState, toLoanQueryParams } from './loan-query';
import {
  LoanDetail,
  LoanLinks,
  LoanList,
  NewLoan,
  NewRepayment
} from './loan.model';

/**
 * La richiesta corrispondente ai criteri correnti.
 *
 * Usa la stessa serializzazione dell'URL: ciò che si legge nell'indirizzo è
 * esattamente ciò che viene chiesto al backend.
 */
export function loansRequest(state: LoanQueryState): HttpResourceRequest {
  let params = new HttpParams();

  for (const [name, value] of Object.entries(toLoanQueryParams(state))) {
    if (value !== null && value !== undefined) {
      params = params.set(name, String(value));
    }
  }

  return { url: `${API_BASE_URL}/loans`, params };
}

export function loanRequest(loanId: string): HttpResourceRequest {
  return { url: `${API_BASE_URL}/loans/${loanId}` };
}

export function loanLinksRequest(): HttpResourceRequest {
  return { url: `${API_BASE_URL}/loans/links` };
}

@Injectable({ providedIn: 'root' })
export class LoansApi {
  private readonly http = inject(HttpClient);

  list(state: LoanQueryState): Observable<LoanList> {
    const request = loansRequest(state);

    return this.http.get<LoanList>(request.url, { params: request.params });
  }

  detail(loanId: string): Observable<LoanDetail> {
    return this.http.get<LoanDetail>(`${API_BASE_URL}/loans/${loanId}`);
  }

  /** L'indice dei movimenti che hanno un prestito dietro. */
  links(): Observable<LoanLinks> {
    return this.http.get<LoanLinks>(`${API_BASE_URL}/loans/links`);
  }

  create(loan: NewLoan): Observable<LoanDetail> {
    return this.http.post<LoanDetail>(`${API_BASE_URL}/loans`, loan);
  }

  update(loanId: string, changes: Partial<Omit<NewLoan, 'transactionId'>>): Observable<LoanDetail> {
    return this.http.patch<LoanDetail>(`${API_BASE_URL}/loans/${loanId}`, changes);
  }

  remove(loanId: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE_URL}/loans/${loanId}`);
  }

  addRepayment(loanId: string, repayment: NewRepayment): Observable<LoanDetail> {
    return this.http.post<LoanDetail>(`${API_BASE_URL}/loans/${loanId}/repayments`, repayment);
  }

  updateRepayment(
    loanId: string,
    repaymentId: string,
    changes: Partial<NewRepayment>
  ): Observable<LoanDetail> {
    return this.http.patch<LoanDetail>(
      `${API_BASE_URL}/loans/${loanId}/repayments/${repaymentId}`,
      changes
    );
  }

  removeRepayment(loanId: string, repaymentId: string): Observable<LoanDetail> {
    return this.http.delete<LoanDetail>(
      `${API_BASE_URL}/loans/${loanId}/repayments/${repaymentId}`
    );
  }
}
