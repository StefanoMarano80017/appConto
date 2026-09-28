import { Component, computed, inject, input, signal } from '@angular/core';
import {
  LucideArrowUpDown,
  LucideCalendarDays,
  LucideFunnel,
  LucideListChecks,
  LucideStore,
  LucideTag
} from '@lucide/angular';
import { Category } from '../categories/category.model';
import { MerchantSummary } from '../merchants/merchant.model';
import {
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_PLURAL_LABELS
} from '../transactions/transaction-type';
import { ClassificationFilter } from './analytics.model';
import { PERIOD_PRESETS } from '../../core/period';
import { Panel } from '../../shared/layout/panel';
import { SectionHeader } from '../../shared/layout/section-header';
import { Badge } from '../../shared/ui/badge';
import { ChoiceGroup } from '../../shared/ui/choice-group';
import { FilterChips } from '../../shared/ui/filter-chips';
import { FilterGroup } from '../../shared/ui/filter-group';
import { SearchInput } from '../../shared/ui/search-input';
import { ToggleButtonGroup } from '../../shared/ui/toggle-button-group';
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
  selector: 'app-analytics-filters',
  imports: [
    Badge,
    ChoiceGroup,
    FilterChips,
    FilterGroup,
    LucideArrowUpDown,
    LucideCalendarDays,
    LucideFunnel,
    LucideListChecks,
    LucideStore,
    LucideTag,
    Panel,
    SearchInput,
    SectionHeader,
    ToggleButtonGroup
  ],
  templateUrl: './analytics-filters.html',
  styleUrl: './analytics-filters.scss'
})
export class AnalyticsFilters {
  readonly categories = input.required<Category[]>();
  readonly merchants = input.required<MerchantSummary[]>();

  protected readonly store = inject(AnalyticsStore);

  protected readonly presets = PERIOD_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.shortLabel,
    description: preset.label
  }));
  protected readonly classifications = CLASSIFICATIONS;
  protected readonly transactionTypes = TRANSACTION_TYPES;
  protected readonly typeLabels = TRANSACTION_TYPE_PLURAL_LABELS;
  protected readonly transactionTypeOptions = TRANSACTION_TYPES.map((type) => ({
    id: type,
    label: TRANSACTION_TYPE_PLURAL_LABELS[type]
  }));

  protected readonly merchantSearch = signal('');

  /** I merchant proposti: quelli cercati, altrimenti quelli su cui si è speso di più. */
  protected readonly suggestedMerchants = computed(() => {
    const search = this.merchantSearch().trim().toLowerCase();
    const merchants =
      search === ''
        ? this.merchants()
        : this.merchants().filter((merchant) => merchant.label.toLowerCase().includes(search));

    return merchants.slice(0, SUGGESTED_MERCHANTS);
  });

  protected readonly categoryOptions = computed(() =>
    this.categories().map((category) => ({ id: category.id, label: category.name }))
  );

  protected readonly merchantOptions = computed(() =>
    this.suggestedMerchants().map((merchant) => ({ id: merchant.id, label: merchant.label }))
  );

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

  protected removeFilter(key: string): void {
    this.activeFilters().find((filter) => filter.key === key)?.remove();
  }

  /*
   * Conta esattamente ciò che `resetFilters()` azzera: tipi, categorie,
   * merchant e classificazione. Il periodo resta fuori da entrambi
   * (`analytics.store.ts:139` riporta `filterState` a `NO_FILTERS` senza
   * toccare `presetState`), quindi il tasto "Azzera" del riepilogo fa
   * esattamente quello che il numero promette, né di più né di meno.
   */
  protected readonly activeCount = computed(() => this.activeFilters().length);

  /*
   * Il testo del badge di riepilogo: mostrato solo quando activeCount() > 0
   * (v. template), quindi qui il caso zero non serve. "attivi" resta
   * concordato al plurale/singolare invece del letterale "N attivi" del
   * mockup: "1 attivi" sarebbe un errore di italiano visibile a ogni utente
   * con un solo filtro acceso.
   */
  protected readonly activeBadgeLabel = computed(() => {
    const count = this.activeCount();
    return count === 1 ? '1 attivo' : `${count} attivi`;
  });
}
