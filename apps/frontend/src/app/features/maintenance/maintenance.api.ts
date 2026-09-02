import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api';
import { RESET_CONFIRMATION, ResetOutcome } from './maintenance.model';

@Injectable({ providedIn: 'root' })
export class MaintenanceApi {
  private readonly http = inject(HttpClient);

  /**
   * Azzera l'archivio.
   *
   * La parola di conferma viaggia nel corpo, e il backend la pretende: non è
   * una formalità dell'interfaccia che si possa aggirare chiamando l'API a
   * mano. Prima di cancellare qualsiasi cosa, il server crea una copia
   * verificata — se non riesce, l'archivio non viene toccato.
   */
  reset(): Observable<ResetOutcome> {
    return this.http.post<ResetOutcome>(`${API_BASE_URL}/reset`, {
      confirm: RESET_CONFIRMATION
    });
  }
}
