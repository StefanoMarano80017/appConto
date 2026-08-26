import { Component, computed, inject, input, signal } from '@angular/core';
import { Category } from '../categories/category.model';
import { MerchantSummary } from '../merchants/merchant.model';
import {
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_PLURAL_LABELS
} from '../transactions/transaction-type';
import { ClassificationFilter } from './analytics.model';
import { PERIOD_PRESETS } from '../../core/period';
import { AnalyticsStore } from './analytics.store';

/** Quanti merchant proporre alla volta: l'elenco completo è quasi sempre lungo. */
const SUGGESTED_MERCHANTS = 8;

const CLASSIFICATIONS: readonly { id: ClassificationFilter; label: string }[] = [
  { id: 'all', label: 'Tutti' },
  { id: 'classified', label: 'Classificati' },
  { id: 'unclassified', label: 'Da classificare' }
];

/** Un criterio attivo, con l'etichetta da mostrare e il modo per toglierlo. */
interface ActiveFilter {
  key: string;
  label: string;
  remove: () => void;
}

/**
 * Periodo e filtri.
 *
 * Non possiede stato proprio: scrive sull'unico store della pagina, così ogni
 * sezione vede lo stesso dataset.
 */
@Component({
  selector: 'app-analytics-toolbar',
  templateUrl: './analytics-toolbar.html',
  styleUrl: './analytics-toolbar.scss'
})
export class AnalyticsToolbar {
  readonly categories = input.required<Category[]>();
  readonly merchants = input.required<MerchantSummary[]>();

  protected readonly store = inject(AnalyticsStore);

  protected readonly presets = PERIOD_PRESETS;
  protected readonly classifications = CLASSIFICATIONS;
  protected readonly transactionTypes = TRANSACTION_TYPES;
  protected readonly typeLabels = TRANSACTION_TYPE_PLURAL_LABELS;

  protected readonly merchantSearch = signal('');
  /** I filtri sono aperti solo su richiesta: su schermi stretti occupano molto. */
  protected readonly showFilters = signal(false);

  /** I merchant proposti: quelli cercati, altrimenti quelli su cui si è speso di più. */
  protected readonly suggestedMerchants = computed(() => {
    const search = this.merchantSearch().trim().toLowerCase();
    const merchants =
      search === ''
        ? this.merchants()
        : this.merchants().filter((merchant) => merchant.label.toLowerCase().includes(search));

    return merchants.slice(0, SUGGESTED_MERCHANTS);
  });

  /** I criteri attivi, con i nomi risolti: un identificativo non dice nulla a video. */
  protected readonly activeFilters = computed<ActiveFilter[]>(() => {
    const { types, categoryIds, merchantIds, classification } = this.store.filters();
    const categories = new Map(this.categories().map((category) => [category.id, category.name]));
    const merchants = new Map(this.merchants().map((merchant) => [merchant.id, merchant.label]));

    return [
      ...types.map((type) => ({
        key: `type-${type}`,
        label: this.typeLabels[type],
        remove: () => this.store.toggleType(type)
      })),
      ...categoryIds.map((id) => ({
        key: `category-${id}`,
        label: categories.get(id) ?? 'Categoria',
        remove: () => this.store.toggleCategory(id)
      })),
      ...merchantIds.map((id) => ({
        key: `merchant-${id}`,
        label: merchants.get(id) ?? 'Merchant',
        remove: () => this.store.toggleMerchant(id)
      })),
      ...(classification === 'all'
        ? []
        : [
            {
              key: 'classification',
              label: classification === 'classified' ? 'Classificati' : 'Da classificare',
              remove: () => this.store.setClassification('all')
            }
          ])
    ];
  });

  protected onFromChange(value: string): void {
    this.store.setCustomRange(value, this.store.dateRange().to);
  }

  protected onToChange(value: string): void {
    this.store.setCustomRange(this.store.dateRange().from, value);
  }
}
