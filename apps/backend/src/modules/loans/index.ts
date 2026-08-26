/** API pubblica della feature `loans`. */
export {
  loanStatus,
  remainingCents,
  type Loan,
  type LoanRepayment,
  type LoanStatus,
} from './loan.model.js';
export {
  DEFAULT_LOAN_QUERY,
  LOAN_SORT_FIELDS,
  LOAN_STATUS_FILTERS,
  parseLoanQuery,
  type LoanQuery,
  type LoanSortField,
  type LoanStatusFilter,
} from './loan-query.js';
export type { LoanAllocation } from './loans.repository.js';
export { loansService } from './loans.service.js';
export type {
  LinkedTransaction,
  LoanDetailViewModel,
  LoanLink,
  LoanLinkRole,
  LoanLinksViewModel,
  LoanListViewModel,
  LoanRepaymentViewModel,
  LoanSummary,
  LoanTotals,
  OriginSplit,
} from './loans.view-model.js';
export { loansRouter } from './loans.routes.js';
