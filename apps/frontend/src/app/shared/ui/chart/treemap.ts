import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { formatAmount, formatPercent } from '../../../core/format';
import { chartColorVar } from './chart.model';
import { groupTopN } from './doughnut-grouping';
import { squarify, type TreemapRect } from './treemap-layout';
import type { TileColor, TreemapActivation } from './treemap.model';

/** Quanto testo ci sta: tutto, il solo nome, niente (resta `aria-label`/`title`). */
type TileSize = 'full' | 'name' | 'none';

interface Tile<T> {
  readonly activation: TreemapActivation<T>;
  readonly rect: TreemapRect;
  readonly name: string;
  readonly amount: string;
  readonly share: string;
  /** Nome accessibile e `title`: l'informazione intera, anche quando la tessera tace. */
  readonly description: string;
  readonly color: string;
  readonly size: TileSize;
  readonly dimmed: boolean;
}

/**
 * Le misure prima che il contenitore sia misurato (e in jsdom, che non
 * misura): servono solo alle proporzioni, quindi conta il rapporto, vicino a
 * quello di una colonna della pagina Analytics.
 */
const DEFAULT_SIZE = { width: 600, height: 400 } as const;

/*
 * Le soglie in pixel sotto cui il testo non ci sta: una riga di nome chiede
 * circa 24px di altezza, nome più importo e quota circa 60. Sono pixel veri,
 * calcolati dalle misure del contenitore, perché il testo non scala con lui.
 */
const FULL_MIN = { width: 96, height: 60 } as const;
const NAME_MIN = { width: 48, height: 24 } as const;

/** Il nome della tessera che raggruppa, col singolare quando raccoglie una sola voce. */
export function groupedTileLabel(count: number, noun: string): string {
  return count === 1 ? `1 altro ${noun}` : `Altri ${count} ${noun}`;
}

/**
 * Treemap condivisa, in solo HTML e CSS: niente canvas, quindi ogni tessera è
 * un `<button>` vero, con focus, tab e Invio/Spazio del browser.
 *
 * Qui sta ciò che è uguale per ogni treemap dell'app: raggruppamento delle
 * voci minori (lo stesso della ciambella), layout «squarified», colori, testo
 * che si ritira dalle tessere piccole, voci in risalto. Il layout è in
 * percentuale e segue il contenitore; le sue misure servono solo a tenere le
 * tessere vicine al quadrato e a decidere quanto testo ci sta.
 *
 * Resta alla feature il significato di dominio: che cosa vuol dire attivare
 * una tessera (`tileActivated`), compresa quella che raggruppa.
 */
@Component({
  selector: 'app-treemap',
  templateUrl: './treemap.html',
  styleUrl: './treemap.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Treemap<T> {
  readonly items = input.required<readonly T[]>();
  readonly value = input.required<(item: T) => number>();
  readonly label = input.required<(item: T) => string>();
  readonly color = input.required<(item: T) => TileColor>();
  readonly topN = input(15);
  /** Il nome delle voci nella tessera che raggruppa: «Altri 4 {othersNoun}». */
  readonly othersNoun = input.required<string>();
  readonly ariaLabel = input.required<string>();
  /**
   * Le voci da far risaltare (es. quelle filtrate): se almeno una tessera lo
   * è, le altre si attenuano. «Altri» risalta se una delle sue voci risalta.
   */
  readonly highlighted = input<(item: T) => boolean>();

  readonly tileActivated = output<TreemapActivation<T>>();

  private readonly size = signal<{ width: number; height: number }>(DEFAULT_SIZE);

  protected readonly tiles = computed<readonly Tile<T>[]>(() => {
    const value = this.value();
    const label = this.label();
    const color = this.color();
    const highlighted = this.highlighted();
    const { width, height } = this.size();

    const groups = groupTopN(this.items(), value, this.topN());
    const rects = squarify(
      groups.map((group) => group.value),
      width,
      height,
    );
    const total = groups.reduce((sum, group) => sum + group.value, 0);
    const isHighlighted = groups.map((group) =>
      highlighted === undefined
        ? false
        : group.kind === 'item'
          ? highlighted(group.item)
          : group.items.some(highlighted),
    );
    const anyHighlighted = isHighlighted.includes(true);

    // Gli indici di `squarify` sono quelli dei gruppi, già in ordine decrescente.
    return rects.map((rect) => {
      const group = groups[rect.index]!;
      const name =
        group.kind === 'item'
          ? label(group.item)
          : groupedTileLabel(group.items.length, this.othersNoun());
      const amount = formatAmount(group.value);
      const share = formatPercent((group.value / total) * 100);

      return {
        activation:
          group.kind === 'item'
            ? { kind: 'item', item: group.item }
            : { kind: 'others', items: group.items },
        rect,
        name,
        amount,
        share,
        description: `${name}: ${amount}, ${share}`,
        // «Altri» non è una voce e non ha un colore suo: neutro.
        color: cssColor(group.kind === 'item' ? color(group.item) : 'chart-neutral'),
        size: tileSize(rect, width, height),
        dimmed: anyHighlighted && !isHighlighted[rect.index],
      };
    });
  });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    // jsdom non ha ResizeObserver: lì restano le misure predefinite.
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry?.contentRect ?? { width: 0, height: 0 };
      // Un contenitore nascosto misura zero: si tiene l'ultima misura buona.
      if (width > 0 && height > 0) {
        this.size.set({ width, height });
      }
    });
    observer.observe(host);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }
}

function cssColor(color: TileColor): string {
  return typeof color === 'string' ? chartColorVar(color) : color.custom;
}

function tileSize(rect: TreemapRect, width: number, height: number): TileSize {
  const w = (rect.w / 100) * width;
  const h = (rect.h / 100) * height;
  if (w >= FULL_MIN.width && h >= FULL_MIN.height) {
    return 'full';
  }
  return w >= NAME_MIN.width && h >= NAME_MIN.height ? 'name' : 'none';
}
