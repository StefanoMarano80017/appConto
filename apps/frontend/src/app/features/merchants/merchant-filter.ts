import { MerchantSummary } from './merchant.model';

export type MerchantFilter = 'all' | 'classified' | 'unclassified';

export interface MerchantFilterOptions {
  search: string;
  filter: MerchantFilter;
}

function matchesFilter(merchant: MerchantSummary, filter: MerchantFilter): boolean {
  switch (filter) {
    case 'classified':
      return merchant.category !== null;
    case 'unclassified':
      return merchant.category === null;
    default:
      return true;
  }
}

/**
 * Selezione dei merchant da mostrare.
 *
 * La ricerca confronta sia il nome scelto dall'utente sia quello originale
 * della banca: dopo una rinomina il merchant resta trovabile con entrambi.
 */
export function filterMerchants(
  merchants: readonly MerchantSummary[],
  { search, filter }: MerchantFilterOptions
): MerchantSummary[] {
  const query = search.trim().toLowerCase();

  return merchants.filter((merchant) => {
    if (!matchesFilter(merchant, filter)) {
      return false;
    }
    if (query === '') {
      return true;
    }

    return (
      merchant.label.toLowerCase().includes(query) || merchant.name.toLowerCase().includes(query)
    );
  });
}
