/** Page sizes offered by the shared transaction pagination controls. */
export const TRANSACTIONS_PAGE_SIZES = [25, 50, 100] as const;

/** Pagination metadata shared by transaction-list views. */
export interface TransactionsPagination {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}
