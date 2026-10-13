/** API pubblica della feature `dashboard`. */
export { dashboardService } from './dashboard.service.js';
export { previousMonth } from './dashboard.period.js';
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
