import { loansService } from "../loans/index.js";
import { transactionsService } from "../transactions/index.js";
import { selectEntries, type AnalyticsQuery } from "./analytics.query.js";
import { aggregateEntries } from "./analytics.aggregation.js";
import { toAnalyticsViewModel } from "./analytics.mapper.js";
import type { AnalyticsViewModel } from "./analytics.view-model.js";

/** API di compatibilità: la logica vive in `analytics.timeline.ts`. */
export { automaticGranularity, startOfWeek } from "./analytics.timeline.js";

/**
 * Caso d'uso "analisi di un periodo".
 *
 * Non possiede dati propri e non conosce SQLite: chiede alle feature
 * `transactions` e `loans` i dati necessari, poi delega aggregazione e mapping
 * alle funzioni pure del modulo analytics.
 */
export const analyticsService = {
  getAnalytics(query: AnalyticsQuery): AnalyticsViewModel {
    const entries = selectEntries(
      transactionsService.listBetweenWithMerchant(query.from, query.to),
      query,
    );
    const lentByTransaction = loansService.lentCentsByTransaction();
    const aggregation = aggregateEntries(entries, lentByTransaction);

    return toAnalyticsViewModel(query, entries, aggregation, lentByTransaction);
  },
};
