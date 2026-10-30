import { HttpResourceRequest } from '@angular/common/http';
import { API_BASE_URL } from '../../core/api';

/**
 * La richiesta del riepilogo.
 *
 * Senza mese è il backend a scegliere quello da mostrare (il mese dell'ultimo
 * movimento): il parametro c'è solo se l'URL ne porta uno valido.
 */
export function dashboardRequest(month: string | null): HttpResourceRequest {
  return month === null
    ? { url: `${API_BASE_URL}/dashboard` }
    : { url: `${API_BASE_URL}/dashboard`, params: { month } };
}
