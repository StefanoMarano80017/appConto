import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { toList, toSingle, type QueryParam } from '../../shared/http/query-params.js';
import { toAmountCents } from './transaction.model.js';
import { transactionTypeSchema, type TransactionType } from './transaction-type.js';

/**
 * Criteri di ricerca delle transazioni.
 *
 * È un contratto di dominio: non conosce Express né SQL. Il repository lo
 * traduce in una query, le altre feature possono comporlo senza sapere come
 * viene eseguito.
 */

/**
 * Stato di classificazione del merchant a cui la transazione è associata.
 *
 * Vive qui, e non nella feature che per prima ne ha avuto bisogno, perché è una
 * proprietà della transazione: `classified` significa `categoryId IS NOT NULL`.
 */
export type ClassificationFilter = 'all' | 'classified' | 'unclassified';

export const CLASSIFICATION_FILTERS: readonly ClassificationFilter[] = [
  'all',
  'classified',
  'unclassified',
];

/** I soli campi su cui è consentito ordinare: la query string non decide. */
export const TRANSACTION_SORT_FIELDS = [
  'bookingDate',
  'amount',
  'merchant',
  'category',
  'type',
] as const;

export type TransactionSortField = (typeof TRANSACTION_SORT_FIELDS)[number];

export type SortDirection = 'asc' | 'desc';

export const PAGE_SIZES = [25, 50, 100] as const;

export const DEFAULT_PAGE_SIZE = 25;

export interface TransactionQuery {
  /** Data contabile iniziale (`YYYY-MM-DD`), inclusa. `null` = dall'inizio. */
  from: string | null;
  /** Data contabile finale (`YYYY-MM-DD`), inclusa. `null` = fino all'ultima. */
  to: string | null;
  /** Testo cercato in descrizione, nome della banca e nome scelto dall'utente. */
  search: string | null;
  /** Elenco vuoto = nessun vincolo. */
  types: TransactionType[];
  categoryIds: string[];
  merchantIds: string[];
  classification: ClassificationFilter;
  /** Confronti sul valore assoluto: "almeno 100 €" vale per entrate e uscite. */
  minAmountCents: number | null;
  maxAmountCents: number | null;
  page: number;
  pageSize: number;
  sortBy: TransactionSortField;
  sortDirection: SortDirection;
}

/** Nessun filtro: la prima pagina dell'archivio, dalla transazione più recente. */
export const DEFAULT_QUERY: TransactionQuery = {
  from: null,
  to: null,
  search: null,
  types: [],
  categoryIds: [],
  merchantIds: [],
  classification: 'all',
  minAmountCents: null,
  maxAmountCents: null,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sortBy: 'bookingDate',
  sortDirection: 'desc',
};

export interface TransactionQueryInput {
  from?: QueryParam;
  to?: QueryParam;
  search?: QueryParam;
  types?: QueryParam;
  categoryIds?: QueryParam;
  merchantIds?: QueryParam;
  classification?: QueryParam;
  minAmount?: QueryParam;
  maxAmount?: QueryParam;
  page?: QueryParam;
  pageSize?: QueryParam;
  sortBy?: QueryParam;
  sortDirection?: QueryParam;
}

const dateSchema = z.iso.date();

function toDate(value: QueryParam, name: string): string | null {
  const raw = toSingle(value);
  if (raw === null) {
    return null;
  }

  const parsed = dateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(`La data "${name}" deve essere nel formato YYYY-MM-DD.`);
  }

  return parsed.data;
}

function toTypes(value: QueryParam): TransactionType[] {
  return toList(value).map((raw) => {
    const parsed = transactionTypeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(`Tipo di movimento "${raw}" non riconosciuto.`);
    }

    return parsed.data;
  });
}

/** Un importo in euro diventa centesimi: i confronti restano interi. */
function toCents(value: QueryParam, name: string): number | null {
  const raw = toSingle(value);
  if (raw === null) {
    return null;
  }

  const amount = Number(raw.replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ValidationError(`L'importo "${name}" deve essere un numero non negativo.`);
  }

  return toAmountCents(amount);
}

function toPositiveInteger(value: QueryParam, name: string, fallback: number): number {
  const raw = toSingle(value);
  if (raw === null) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ValidationError(`Il parametro "${name}" deve essere un intero positivo.`);
  }

  return parsed;
}

export function parseTransactionQuery(input: TransactionQueryInput): TransactionQuery {
  const from = toDate(input.from, 'from');
  const to = toDate(input.to, 'to');
  if (from !== null && to !== null && from > to) {
    throw new ValidationError(
      'Intervallo non valido: la data iniziale è successiva a quella finale.',
    );
  }

  const minAmountCents = toCents(input.minAmount, 'minAmount');
  const maxAmountCents = toCents(input.maxAmount, 'maxAmount');
  if (minAmountCents !== null && maxAmountCents !== null && minAmountCents > maxAmountCents) {
    throw new ValidationError('Intervallo di importo non valido: il minimo supera il massimo.');
  }

  const classification = toSingle(input.classification) ?? 'all';
  if (!CLASSIFICATION_FILTERS.includes(classification as ClassificationFilter)) {
    throw new ValidationError(`Stato di classificazione "${classification}" non riconosciuto.`);
  }

  const sortBy = toSingle(input.sortBy) ?? DEFAULT_QUERY.sortBy;
  if (!TRANSACTION_SORT_FIELDS.includes(sortBy as TransactionSortField)) {
    throw new ValidationError(
      `Ordinamento "${sortBy}" non consentito: usare uno fra ${TRANSACTION_SORT_FIELDS.join(', ')}.`,
    );
  }

  const sortDirection = toSingle(input.sortDirection) ?? DEFAULT_QUERY.sortDirection;
  if (sortDirection !== 'asc' && sortDirection !== 'desc') {
    throw new ValidationError('La direzione di ordinamento deve essere "asc" oppure "desc".');
  }

  const pageSize = toPositiveInteger(input.pageSize, 'pageSize', DEFAULT_PAGE_SIZE);
  if (!PAGE_SIZES.includes(pageSize as (typeof PAGE_SIZES)[number])) {
    throw new ValidationError(`Il parametro "pageSize" deve valere ${PAGE_SIZES.join(', ')}.`);
  }

  const search = toSingle(input.search);

  return {
    from,
    to,
    search: search === null || search.length === 0 ? null : search,
    types: toTypes(input.types),
    categoryIds: toList(input.categoryIds),
    merchantIds: toList(input.merchantIds),
    classification: classification as ClassificationFilter,
    minAmountCents,
    maxAmountCents,
    page: toPositiveInteger(input.page, 'page', 1),
    pageSize,
    sortBy: sortBy as TransactionSortField,
    sortDirection,
  };
}
