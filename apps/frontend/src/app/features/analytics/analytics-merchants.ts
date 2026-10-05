import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal
} from '@angular/core';
import { LucideLayoutGrid, LucideList } from '@lucide/angular';
import { Panel } from '../../shared/layout/panel';
import { SectionHeader } from '../../shared/layout/section-header';
import { Amount } from '../../shared/ui/amount';
import { Treemap } from '../../shared/ui/chart/treemap';
import type { TileColor, TreemapActivation } from '../../shared/ui/chart/treemap.model';
import { ChoiceGroup, ChoiceOption } from '../../shared/ui/choice-group';
import { Category } from '../categories/category.model';
import { MerchantDistribution } from './analytics.model';

type MerchantsView = 'chart' | 'list';

/** Quanti merchant mostrare prima di chiedere conferma: la coda è quasi sempre lunga. */
const INITIAL_LIMIT = 10;

/** Quanti merchant conta la frase sulla concentrazione. */
const CONCENTRATION_TOP = 5;

/**
 * Distribuzione delle spese per merchant: "da chi sto spendendo di più?".
 *
 * Due viste sugli stessi dati, come per le categorie: la treemap dice dove
 * vanno i soldi e quanto la spesa è concentrata (la frase sopra lo dice in
 * numeri), la lista dà tutti i merchant con categoria e conteggio. La treemap
 * raggruppa la coda in «Altri», che non è un merchant: il clic lì apre la
 * Lista per intero, col focus sul primo merchant raggruppato.
 *
 * Le tessere prendono il colore della categoria del merchant: la distribuzione
 * porta solo il nome della categoria, il colore arriva dall'elenco `categories`.
 */
@Component({
  selector: 'app-analytics-merchants',
  imports: [Panel, SectionHeader, Amount, ChoiceGroup, Treemap],
  templateUrl: './analytics-merchants.html',
  styleUrl: './analytics-merchants.scss'
})
export class AnalyticsMerchants {
  readonly merchants = input.required<MerchantDistribution[]>();
  /** I merchant già nei filtri: premuti nella Lista, in risalto nella treemap. */
  readonly activeMerchantIds = input<readonly string[]>([]);
  /** Le categorie con il loro colore: servono solo a colorare le tessere. */
  readonly categories = input<readonly Pick<Category, 'name' | 'color'>[]>([]);

  /** Richiesta di restringere l'analisi ad un merchant. */
  readonly merchantSelected = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly view = signal<MerchantsView>('chart');
  protected readonly views: readonly ChoiceOption<MerchantsView>[] = [
    { id: 'chart', label: 'Grafico', icon: LucideLayoutGrid.icon },
    { id: 'list', label: 'Lista', icon: LucideList.icon }
  ];

  protected readonly expanded = signal(false);

  protected readonly visible = computed(() =>
    this.expanded() ? this.merchants() : this.merchants().slice(0, INITIAL_LIMIT)
  );

  protected readonly hidden = computed(() =>
    Math.max(this.merchants().length - INITIAL_LIMIT, 0)
  );

  /** La treemap disegna solo spese positive: un rimborso netto non è una tessera. */
  protected readonly hasSpending = computed(() =>
    this.merchants().some((merchant) => merchant.amount > 0)
  );

  /** I merchant sono già ordinati per spesa: i primi sono quelli che pesano di più. */
  protected readonly concentration = computed(() => {
    const merchants = this.merchants();
    if (merchants.length === 1) {
      return 'Un solo merchant: tutte le uscite';
    }
    const top = merchants.slice(0, CONCENTRATION_TOP);
    const share = Math.round(top.reduce((sum, merchant) => sum + merchant.percentage, 0));

    return `I primi ${top.length} merchant fanno il ${share}% delle uscite`;
  });

  // Campi e non metodi: la treemap li riceve come input, e un riferimento nuovo
  // a ogni rendering le farebbe ricalcolare le tessere per niente.
  protected readonly tileValue = (merchant: MerchantDistribution): number => merchant.amount;
  protected readonly tileLabel = (merchant: MerchantDistribution): string => merchant.name;

  // Calcolati e non metodi, per la stessa ragione: cambiano solo coi loro input.
  protected readonly tileColor = computed(() => {
    const colors = new Map(this.categories().map((category) => [category.name, category.color]));
    return (merchant: MerchantDistribution): TileColor => {
      const color = merchant.category === null ? undefined : colors.get(merchant.category);
      return color ? { custom: color } : 'chart-neutral';
    };
  });

  protected readonly isActive = computed(() => {
    const ids = this.activeMerchantIds();
    return (merchant: MerchantDistribution): boolean =>
      merchant.merchantId !== null && ids.includes(merchant.merchantId);
  });

  protected onTileActivated(tile: TreemapActivation<MerchantDistribution>): void {
    if (tile.kind === 'item') {
      // Senza identificativo non c'è un filtro a cui portare.
      if (tile.item.merchantId !== null) {
        this.merchantSelected.emit(tile.item.merchantId);
      }
      return;
    }

    this.view.set('list');
    this.expanded.set(true);
    this.focusGroupedRow(tile.items);
  }

  /**
   * Passare alla Lista distrugge la tessera che aveva il focus, che da
   * tastiera finirebbe su <body>. Lo si porta sul primo merchant raggruppato
   * che si possa filtrare, cioè dove chi ha scelto «Altri» voleva arrivare; se
   * non ce n'è uno, sul toggle. Solo a Lista resa: prima non esiste.
   */
  private focusGroupedRow(grouped: readonly MerchantDistribution[]): void {
    afterNextRender(
      () => {
        const rows = this.host.nativeElement.querySelectorAll<HTMLElement>('ol li');
        const target = grouped
          .map((merchant) => rows[this.merchants().indexOf(merchant)]?.querySelector<HTMLElement>('button.link'))
          .find((button) => button !== null && button !== undefined);
        (target ?? this.activeViewToggle())?.focus();
      },
      { injector: this.injector }
    );
  }

  private activeViewToggle(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(
      'app-choice-group button[aria-pressed="true"]'
    );
  }
}
