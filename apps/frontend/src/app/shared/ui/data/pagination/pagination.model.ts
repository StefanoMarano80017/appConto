/** Dimensioni di pagina offerte dai controlli di paginazione condivisi. */
export const PAGE_SIZES = [25, 50, 100] as const;

/** Metadati di paginazione condivisi dalle viste a elenco. */
export interface PaginationData {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}
