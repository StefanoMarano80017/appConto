import { Component, input } from '@angular/core';

/**
 * Un criterio nella toolbox: etichetta più il controllo che lo governa.
 *
 * È il mattone che rende le toolbox identiche fra viste, come
 * DESIGN_SYSTEM.md §6 richiede: cambia il contenuto, non la forma. Oggi lo
 * stesso concetto esiste in tre forme diverse (un `h3` in Analytics, un
 * `<details>` in Movimenti, niente affatto in Dashboard).
 *
 * Non sa cosa sia il controllo che contiene: lo proietta e basta.
 */
@Component({
  selector: 'app-filter-group',
  templateUrl: './filter-group.html',
  styleUrl: './filter-group.scss'
})
export class FilterGroup {
  readonly label = input.required<string>();
}
