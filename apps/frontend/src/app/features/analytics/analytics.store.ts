import { Injectable, computed, signal } from '@angular/core';
import { formatBookingDate } from '../../core/format';
import { TransactionType } from '../transactions/transaction-type';
import { ClassificationFilter, TimelineGranularity } from './analytics.model';
import {
  DateRange,
  PERIOD_PRESET_LABELS,
  PeriodPreset,
  resolvePeriod
} from '../../core/period';

/** Criteri diversi dal periodo. Un elenco vuoto significa "tutti". */
export interface AnalyticsFilterState {
  types: TransactionType[];
  categoryIds: string[];
  merchantIds: string[];
  classification: ClassificationFilter;
}

/** Ciò che viene chiesto al backend: periodo, filtri e passo della spezzata. */
export interface AnalyticsQueryState extends AnalyticsFilterState, DateRange {
  granularity: TimelineGranularity;
}

const INITIAL_PRESET: PeriodPreset = 'this-year';

/** Il passo di partenza: la settimana è la scala a cui si riconosce un'abitudine. */
const INITIAL_GRANULARITY: TimelineGranularity = 'week';

const NO_FILTERS: AnalyticsFilterState = {
  types: [],
  categoryIds: [],
  merchantIds: [],
  classification: 'all'
};

/** Aggiunge o toglie un valore: è il comportamento di ogni selezione multipla. */
function toggle(values: readonly string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

/**
 * Stato della pagina Analytics.
 *
 * Esiste un solo periodo e un solo insieme di filtri: nessun widget ne possiede
 * una copia, quindi non possono rappresentare dataset diversi.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsStore {
  private readonly presetState = signal<PeriodPreset>(INITIAL_PRESET);
  private readonly rangeState = signal<DateRange>(resolvePeriod(INITIAL_PRESET, new Date()));
  private readonly filterState = signal<AnalyticsFilterState>(NO_FILTERS);
  private readonly granularityState = signal<TimelineGranularity>(INITIAL_GRANULARITY);

  readonly preset = this.presetState.asReadonly();
  readonly dateRange = this.rangeState.asReadonly();
  readonly filters = this.filterState.asReadonly();
  readonly granularity = this.granularityState.asReadonly();

  /** L'unica cosa che la pagina chiede al backend. */
  readonly query = computed<AnalyticsQueryState>(() => ({
    ...this.rangeState(),
    ...this.filterState(),
    granularity: this.granularityState()
  }));

  readonly hasFilters = computed(() => {
    const { types, categoryIds, merchantIds, classification } = this.filterState();

    return (
      types.length + categoryIds.length + merchantIds.length > 0 || classification !== 'all'
    );
  });

  readonly selectedPeriodLabel = computed(() => {
    const { from, to } = this.rangeState();
    if (this.presetState() !== 'custom') {
      return PERIOD_PRESET_LABELS[this.presetState()];
    }
    if (from === null && to === null) {
      return PERIOD_PRESET_LABELS.all;
    }

    const start = from === null ? 'inizio' : formatBookingDate(from);
    const end = to === null ? 'oggi' : formatBookingDate(to);

    return `${start} → ${end}`;
  });

  selectPreset(preset: PeriodPreset): void {
    this.presetState.set(preset);
    this.rangeState.set(resolvePeriod(preset, new Date()));
  }

  /** Un periodo scelto a mano: le due date diventano gli estremi dell'analisi. */
  setCustomRange(from: string | null, to: string | null): void {
    this.presetState.set('custom');
    this.rangeState.set({ from: from || null, to: to || null });
  }

  toggleType(type: TransactionType): void {
    this.filterState.update((state) => ({
      ...state,
      types: toggle(state.types, type) as TransactionType[]
    }));
  }

  toggleCategory(categoryId: string): void {
    this.filterState.update((state) => ({
      ...state,
      categoryIds: toggle(state.categoryIds, categoryId)
    }));
  }

  toggleMerchant(merchantId: string): void {
    this.filterState.update((state) => ({
      ...state,
      merchantIds: toggle(state.merchantIds, merchantId)
    }));
  }

  setClassification(classification: ClassificationFilter): void {
    this.filterState.update((state) => ({ ...state, classification }));
  }

  /**
   * Cambia il passo dell'andamento nel tempo.
   *
   * Non è un filtro: gli stessi movimenti vengono solo raggruppati in
   * intervalli più fini o più larghi.
   */
  setGranularity(granularity: TimelineGranularity): void {
    this.granularityState.set(granularity);
  }

  /** Riporta i criteri alla situazione iniziale, mantenendo il periodo osservato. */
  resetFilters(): void {
    this.filterState.set(NO_FILTERS);
  }
}
