import { Component, computed, input, output } from '@angular/core';

/**
 * L'intestazione ordinabile di una colonna.
 *
 * Il selettore è `th[app-sortable-header]` perché una cella d'intestazione
 * deve restare un `<th>` nel DOM della tabella: avvolgerla in un elemento
 * custom romperebbe la relazione fra intestazione e celle su cui si reggono
 * gli screen reader.
 *
 * `aria-sort` vale sempre qualcosa, anche `none`: una colonna che tace non
 * dice "non ordinata", dice "non ordinabile".
 */
@Component({
  selector: 'th[app-sortable-header]',
  templateUrl: './sortable-header.html',
  styleUrl: './sortable-header.scss',
  host: {
    scope: 'col',
    '[attr.aria-sort]': 'ariaSort()'
  }
})
export class SortableHeader {
  readonly label = input.required<string>();
  readonly active = input.required<boolean>();
  readonly direction = input<'asc' | 'desc'>('asc');

  readonly sorted = output<void>();

  protected readonly ariaSort = computed(() => {
    if (!this.active()) {
      return 'none';
    }

    return this.direction() === 'asc' ? 'ascending' : 'descending';
  });
}
