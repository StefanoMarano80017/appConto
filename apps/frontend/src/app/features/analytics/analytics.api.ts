import { HttpParams, HttpResourceRequest } from '@angular/common/http';
import { API_BASE_URL } from '../../core/api';
import { AnalyticsQueryState } from './analytics.store';

/**
 * La richiesta corrispondente ai criteri correnti.
 *
 * È una funzione pura: la pagina la passa a `httpResource`, che si occupa di
 * rifare la chiamata quando i criteri cambiano e di annullare quella
 * precedente.
 */
export function analyticsRequest(query: AnalyticsQueryState): HttpResourceRequest {
  let params = new HttpParams();

  if (query.from !== null) {
    params = params.set('from', query.from);
  }
  if (query.to !== null) {
    params = params.set('to', query.to);
  }
  if (query.types.length > 0) {
    params = params.set('types', query.types.join(','));
  }
  if (query.categoryIds.length > 0) {
    params = params.set('categoryIds', query.categoryIds.join(','));
  }
  if (query.merchantIds.length > 0) {
    params = params.set('merchantIds', query.merchantIds.join(','));
  }
  if (query.classification !== 'all') {
    params = params.set('classification', query.classification);
  }
  params = params.set('granularity', query.granularity);

  return { url: `${API_BASE_URL}/analytics`, params };
}
