import { Component, input, output } from '@angular/core';

export interface FilterChip<T> {
  key: T;
  label: string;
}

/**
 * Riga di filtri attivi rimovibili, più un pulsante di reset.
 *
 * Non possiede lo stato dei filtri: emette solo la chiave su cui si è
 * cliccato, o l'intenzione di azzerarli tutti. La pagina, che già sa come
 * tradurre una chiave in una modifica ai propri criteri, resta l'unica a
 * decidere cosa succede.
 */
@Component({
  selector: 'app-filter-chips',
  templateUrl: './filter-chips.html',
  styleUrl: './filter-chips.scss'
})
export class FilterChips<T> {
  readonly chips = input.required<readonly FilterChip<T>[]>();
  readonly clearLabel = input('Reset filtri');

  readonly removed = output<T>();
  readonly cleared = output<void>();
}
