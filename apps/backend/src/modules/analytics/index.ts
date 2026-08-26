/** API pubblica della feature `analytics`. */
export {
  ALL_TRANSACTIONS,
  parseAnalyticsQuery,
  selectEntries,
  type AnalyticsQuery,
  type ClassificationFilter,
} from './analytics.query.js';
export { analyticsService, startOfWeek } from './analytics.service.js';
export type {
  AnalyticsCounts,
  AnalyticsOverview,
  AnalyticsPeriod,
  AnalyticsViewModel,
  CategoryDistribution,
  LoanEntry,
  LoansSection,
  MerchantDistribution,
  Timeline,
  TimelineBucket,
  TimelineGranularity,
} from './analytics.view-model.js';
export { analyticsRouter } from './analytics.routes.js';
