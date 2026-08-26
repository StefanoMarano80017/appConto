import { Component, computed, input, output } from '@angular/core';
import { PAGE_SIZES } from './transaction-query';
import { TransactionPage } from './transaction.model';

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
  selector: 'app-transactions-pagination',
  templateUrl: './transactions-pagination.html',
  styleUrl: './transactions-pagination.scss'
})
export class TransactionsPagination {
  readonly pagination = input.required<TransactionPage['pagination']>();

  readonly pageSelected = output<number>();
  readonly pageSizeSelected = output<number>();

  protected readonly pageSizes = PAGE_SIZES;

  /** `41–60 di 279 transazioni`. */
  protected readonly range = computed(() => {
    const { page, pageSize, total } = this.pagination();
    if (total === 0) {
      return null;
    }

    const first = (page - 1) * pageSize + 1;

    return { first, last: Math.min(page * pageSize, total), total };
  });

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
