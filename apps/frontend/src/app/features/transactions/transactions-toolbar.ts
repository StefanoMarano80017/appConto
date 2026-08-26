import { Component, computed, input, output, signal } from '@angular/core';
import { formatBookingDate } from '../../core/format';
import { PERIOD_PRESETS, PeriodPreset, matchingPreset, resolvePeriod } from '../../core/period';
import { Category } from '../categories/category.model';
import { MerchantSummary } from '../merchants/merchant.model';
import {
  CLASSIFICATION_LABELS,
  ClassificationFilter,
  TransactionQueryState
} from './transaction-query';
import { TRANSACTION_TYPES, TRANSACTION_TYPE_PLURAL_LABELS } from './transaction-type';
import { TransactionType } from './transaction-type';

/** Quanti merchant proporre alla volta: l'elenco completo è ingestibile. */
const SUGGESTED_MERCHANTS = 8;

/** Un criterio attivo, con l'etichetta da mostrare e i criteri che lo tolgono. */
interface ActiveFilter {
  key: string;
  label: string;
  removal: Partial<TransactionQueryState>;
}

/**
 * Ricerca e filtri dell'esplorazione.
 *
 * Non possiede stato: riceve i criteri correnti e ne emette di nuovi. L'unica
 * fonte di verità resta l'URL, gestito dalla pagina.
 */
@Component({
  selector: 'app-transactions-toolbar',
  templateUrl: './transactions-toolbar.html',
  styleUrl: './transactions-toolbar.scss'
})
export class TransactionsToolbar {
  readonly query = input.required<TransactionQueryState>();
  readonly categories = input.required<Category[]>();
  readonly merchants = input.required<MerchantSummary[]>();
  /** Testo della ricerca mentre si digita: la pagina lo trattiene prima di navigare. */
  readonly searchText = input.required<string>();

  /** Criteri da applicare; la pagina si occupa di riportare a pagina 1. */
  readonly changed = output<Partial<TransactionQueryState>>();
  readonly searchTyped = output<string>();
  readonly cleared = output<void>();

  protected readonly presets = PERIOD_PRESETS;
  protected readonly transactionTypes = TRANSACTION_TYPES;
  protected readonly typeLabels = TRANSACTION_TYPE_PLURAL_LABELS;
  protected readonly classificationLabels = CLASSIFICATION_LABELS;
  protected readonly classifications: ClassificationFilter[] = [
    'all',
    'classified',
    'unclassified'
  ];

  /** Quale pulsante di periodo evidenziare: dedotto dalle date, non memorizzato. */
  protected readonly preset = computed(() => matchingPreset(this.query(), new Date()));

  protected readonly periodLabel = computed(() => {
    const { from, to } = this.query();
    if (from === null && to === null) {
      return 'Tutto';
    }

    return `${from === null ? 'inizio' : formatBookingDate(from)} → ${
      to === null ? 'oggi' : formatBookingDate(to)
    }`;
  });

  /** Ricerca del solo elenco a tendina: non è un criterio, non finisce nell'URL. */
  protected readonly merchantSearch = signal('');

  protected readonly suggestedMerchants = computed(() => {
    const search = this.merchantSearch().trim().toLowerCase();
    const selected = new Set(this.query().merchantIds);

    const matching =
      search === ''
        ? this.merchants()
        : this.merchants().filter(
            (merchant) =>
              merchant.label.toLowerCase().includes(search) ||
              merchant.name.toLowerCase().includes(search)
          );

    // I merchant già scelti restano visibili anche se la ricerca non li trova.
    const chosen = this.merchants().filter((merchant) => selected.has(merchant.id));
    const rest = matching.filter((merchant) => !selected.has(merchant.id));

    return [...chosen, ...rest.slice(0, SUGGESTED_MERCHANTS)];
  });

  /** I criteri attivi, con i nomi risolti: un identificativo non dice nulla a video. */
  protected readonly activeFilters = computed<ActiveFilter[]>(() => {
    const query = this.query();
    const categories = new Map(this.categories().map((category) => [category.id, category.name]));
    const merchants = new Map(this.merchants().map((merchant) => [merchant.id, merchant.label]));

    const filters: ActiveFilter[] = [];

    if (query.from !== null || query.to !== null) {
      filters.push({ key: 'period', label: this.periodLabel(), removal: { from: null, to: null } });
    }
    if (query.search !== '') {
      filters.push({ key: 'search', label: `"${query.search}"`, removal: { search: '' } });
    }
    for (const type of query.types) {
      filters.push({
        key: `type-${type}`,
        label: this.typeLabels[type],
        removal: { types: query.types.filter((item) => item !== type) }
      });
    }
    for (const id of query.categoryIds) {
      filters.push({
        key: `category-${id}`,
        label: categories.get(id) ?? 'Categoria',
        removal: { categoryIds: query.categoryIds.filter((item) => item !== id) }
      });
    }
    for (const id of query.merchantIds) {
      filters.push({
        key: `merchant-${id}`,
        label: merchants.get(id) ?? 'Merchant',
        removal: { merchantIds: query.merchantIds.filter((item) => item !== id) }
      });
    }
    if (query.classification !== 'all') {
      filters.push({
        key: 'classification',
        label: this.classificationLabels[query.classification],
        removal: { classification: 'all' }
      });
    }
    if (query.minAmount !== '' || query.maxAmount !== '') {
      const min = query.minAmount === '' ? '0' : query.minAmount;
      const max = query.maxAmount === '' ? '∞' : query.maxAmount;
      filters.push({
        key: 'amount',
        label: `${min} – ${max} €`,
        removal: { minAmount: '', maxAmount: '' }
      });
    }

    return filters;
  });

  protected selectPreset(preset: PeriodPreset): void {
    this.changed.emit(resolvePeriod(preset, new Date()));
  }

  protected toggleType(type: TransactionType): void {
    const types = this.query().types;

    this.changed.emit({
      types: types.includes(type) ? types.filter((item) => item !== type) : [...types, type]
    });
  }

  protected toggleCategory(categoryId: string): void {
    const categoryIds = this.query().categoryIds;

    this.changed.emit({
      categoryIds: categoryIds.includes(categoryId)
        ? categoryIds.filter((item) => item !== categoryId)
        : [...categoryIds, categoryId]
    });
  }

  protected toggleMerchant(merchantId: string): void {
    const merchantIds = this.query().merchantIds;

    this.changed.emit({
      merchantIds: merchantIds.includes(merchantId)
        ? merchantIds.filter((item) => item !== merchantId)
        : [...merchantIds, merchantId]
    });
  }
}
