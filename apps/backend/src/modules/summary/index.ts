/** API pubblica della feature `summary`. */
export { summaryService, summarizeEntries, requireMonth } from './summary.service.js';
export { summaryRouter } from './summary.routes.js';
export type {
  SummaryViewModel,
  CategorySummary,
  UncategorizedSummary,
} from './summary.view-model.js';
