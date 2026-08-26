/** API pubblica della feature `dashboard`. */
export { dashboardService, previousMonth } from './dashboard.service.js';
export { dashboardRouter } from './dashboard.routes.js';
export {
  applyFilters,
  parseFilters,
  NO_FILTERS,
  type DashboardFilters,
} from './dashboard-filters.js';
export type {
  DashboardViewModel,
  CategoryBreakdown,
  MerchantBreakdown,
  MonthComparison,
  TopMerchant,
  TransactionRef,
} from './dashboard.view-model.js';
