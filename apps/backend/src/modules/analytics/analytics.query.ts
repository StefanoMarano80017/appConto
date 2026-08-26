import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { toList, toSingle, type QueryParam } from '../../shared/http/query-params.js';
import {
  CLASSIFICATION_FILTERS,
  transactionTypeSchema,
  type ClassificationFilter,
  type TransactionType,
  type TransactionWithMerchant,
} from '../transactions/index.js';
import type { TimelineGranularity } from './analytics.view-model.js';

export type { ClassificationFilter };

const GRANULARITIES: readonly TimelineGranularity[] = ['day', 'week', 'month'];

/**
 * Criteri di selezione dell'analisi.
 *
 * È l'unico parametro dell'API: ogni sezione della dashboard rappresenta lo
 * stesso insieme selezionato da questa query, non un insieme proprio.
 *
 * Un elenco vuoto significa "nessun vincolo", non "nessun risultato": è la
 * differenza fra "tutte le categorie" e "nessuna categoria".
 */
export interface AnalyticsQuery {
  /** Data contabile iniziale (`YYYY-MM-DD`), inclusa. `null` = dall'inizio. */
  from: string | null;
  /** Data contabile finale (`YYYY-MM-DD`), inclusa. `null` = fino all'ultimo movimento. */
  to: string | null;
  types: TransactionType[];
  categoryIds: string[];
  merchantIds: string[];
  classification: ClassificationFilter;
  /**
   * Passo dell'andamento nel tempo. `null` lo fa scegliere dall'ampiezza del
   * periodo: non è un filtro, non cambia quali movimenti entrano nel conto.
   */
  granularity: TimelineGranularity | null;
}

/** Nessun vincolo: tutto l'archivio. */
export const ALL_TRANSACTIONS: AnalyticsQuery = {
  from: null,
  to: null,
  types: [],
  categoryIds: [],
  merchantIds: [],
  classification: 'all',
  granularity: null,
};

export interface AnalyticsQueryInput {
  from?: QueryParam;
  to?: QueryParam;
  types?: QueryParam;
  categoryIds?: QueryParam;
  merchantIds?: QueryParam;
  classification?: QueryParam;
  granularity?: QueryParam;
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

function toClassification(value: QueryParam): ClassificationFilter {
  const raw = toSingle(value);
  if (raw === null) {
    return 'all';
  }
  if (!CLASSIFICATION_FILTERS.includes(raw as ClassificationFilter)) {
    throw new ValidationError(`Stato di classificazione "${raw}" non riconosciuto.`);
  }

  return raw as ClassificationFilter;
}

function toGranularity(value: QueryParam): TimelineGranularity | null {
  const raw = toSingle(value);
  if (raw === null || raw === 'auto') {
    return null;
  }
  if (!GRANULARITIES.includes(raw as TimelineGranularity)) {
    throw new ValidationError(
      `Passo "${raw}" non riconosciuto: usare uno fra ${GRANULARITIES.join(', ')}.`,
    );
  }

  return raw as TimelineGranularity;
}

/** Interpreta i criteri arrivati dalla query string. */
export function parseAnalyticsQuery(input: AnalyticsQueryInput): AnalyticsQuery {
  const from = toDate(input.from, 'from');
  const to = toDate(input.to, 'to');

  if (from !== null && to !== null && from > to) {
    throw new ValidationError('Intervallo non valido: la data iniziale è successiva a quella finale.');
  }

  return {
    from,
    to,
    types: toTypes(input.types),
    categoryIds: toList(input.categoryIds),
    merchantIds: toList(input.merchantIds),
    classification: toClassification(input.classification),
    granularity: toGranularity(input.granularity),
  };
}

/**
 * Seleziona le transazioni che soddisfano i criteri diversi dal periodo.
 *
 * Il periodo è già stato applicato dalla lettura: qui restano i filtri che
 * dipendono dal merchant e dalla sua categoria, che vivono fuori dalla
 * transazione.
 */
export function selectEntries(
  entries: readonly TransactionWithMerchant[],
  { types, categoryIds, merchantIds, classification }: AnalyticsQuery,
): TransactionWithMerchant[] {
  const wantedTypes = new Set(types);
  const wantedCategories = new Set(categoryIds);
  const wantedMerchants = new Set(merchantIds);

  return entries.filter(({ transaction, merchant }) => {
    if (wantedTypes.size > 0 && !wantedTypes.has(transaction.type)) {
      return false;
    }
    if (wantedMerchants.size > 0 && !wantedMerchants.has(transaction.merchantId ?? '')) {
      return false;
    }

    const categoryId = merchant?.category?.id ?? null;
    if (wantedCategories.size > 0 && (categoryId === null || !wantedCategories.has(categoryId))) {
      return false;
    }
    if (classification === 'classified' && categoryId === null) {
      return false;
    }
    if (classification === 'unclassified' && categoryId !== null) {
      return false;
    }

    return true;
  });
}
