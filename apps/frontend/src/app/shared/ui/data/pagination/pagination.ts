import { Component, computed, input, output } from '@angular/core';
import { LucideChevronLeft, LucideChevronRight } from '@lucide/angular';
import { Select } from '@shared/ui/forms/select/select';
import type { SelectOption } from '@shared/ui/forms/select/select.model';
import { PAGE_SIZES } from './pagination.model';
import type { PaginationData } from './pagination.model';

/** Quante pagine mostrare attorno a quella corrente prima di troncare con i puntini. */
const WINDOW = 1;

/** Una voce della barra: una pagina, oppure il salto fra due gruppi. */
type PageSlot = { kind: 'page'; page: number } | { kind: 'gap' };

/**
 * Navigazione fra le pagine.
 *
 * Dice sempre quali risultati si stanno vedendo e quanti ce ne sono: chi guarda
 * deve sapere di essere davanti ad una pagina, non all'intero archivio.
 */
@Component({
  selector: 'app-pagination',
  imports: [LucideChevronLeft, LucideChevronRight, Select],
  templateUrl: './pagination.html',
  styleUrl: './pagination.scss',
})
export class Pagination {
  readonly pagination = input.required<PaginationData>();

  /** Nome plurale degli elementi, es. `transazioni`, `merchant`. */
  readonly itemLabel = input.required<string>();

  /** Testo senza risultati; se assente è `Nessun` seguito da `itemLabel`. */
  readonly emptyLabel = input<string>();

  readonly pageSelected = output<number>();
  readonly pageSizeSelected = output<number>();

  /** Le dimensioni di pagina come voci del select: id e nome sono il numero in stringa. */
  protected readonly pageSizeOptions: readonly SelectOption<string>[] = PAGE_SIZES.map(
    (size) => ({ id: String(size), name: String(size) }),
  );

  /** La dimensione corrente nella forma che il select confronta con gli `id`. */
  protected readonly pageSizeValue = computed(() => String(this.pagination().pageSize));

  /**
   * `41–60 di 279 merchant`; `null` senza risultati.
   *
   * Una pagina oltre l'ultima (capita quando si svuota l'ultima pagina
   * classificandone le righe) non ha un intervallo sensato: si dice solo
   * quanti risultati ci sono, `60 merchant`, invece di `76–60 di 60`.
   */
  protected readonly range = computed(() => {
    const { page, pageSize, total } = this.pagination();
    if (total === 0) {
      return null;
    }

    const first = (page - 1) * pageSize + 1;
    if (first > total) {
      return `${total} ${this.itemLabel()}`;
    }

    return `${first}–${Math.min(page * pageSize, total)} di ${total} ${this.itemLabel()}`;
  });

  /** Il testo quando non c'è nulla da mostrare. */
  protected readonly emptyText = computed(() => this.emptyLabel() ?? `Nessun ${this.itemLabel()}`);

  /** Prima, ultima e le pagine vicine a quella corrente: il resto sono puntini. */
  protected readonly slots = computed<PageSlot[]>(() => {
    const { page, totalPages } = this.pagination();

    const wanted = new Set<number>([1, totalPages]);
    for (let candidate = page - WINDOW; candidate <= page + WINDOW; candidate += 1) {
      if (candidate >= 1 && candidate <= totalPages) {
        wanted.add(candidate);
      }
    }

    const pages = [...wanted].sort((a, b) => a - b);

    return pages.flatMap((value, index): PageSlot[] => {
      const previous = pages[index - 1];
      const gap = previous !== undefined && value - previous > 1;

      return gap
        ? [{ kind: 'gap' }, { kind: 'page', page: value }]
        : [{ kind: 'page', page: value }];
    });
  });
}
