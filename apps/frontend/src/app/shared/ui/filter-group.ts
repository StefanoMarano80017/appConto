import { Component, input } from '@angular/core';

let nextId = 0;

/**
 * Un criterio nella toolbox: etichetta più il controllo che lo governa.
 *
 * È il mattone che rende le toolbox identiche fra viste, come
 * DESIGN_SYSTEM.md §6 richiede: cambia il contenuto, non la forma. Oggi lo
 * stesso concetto esiste in tre forme diverse (un `h3` in Analytics, un
 * `<details>` in Movimenti, niente affatto in Dashboard).
 *
 * Non sa cosa sia il controllo che contiene: lo proietta e basta. L'unica
 * associazione che deve garantire da sé è quella con lo screen reader: senza
 * `role="group"` più `aria-labelledby` verso l'etichetta, chi non vede
 * sentirebbe il controllo proiettato senza sapere a che criterio appartiene.
 * L'id è generato una sola volta per istanza (contatore di modulo), non a
 * ogni change detection.
 */
@Component({
  selector: 'app-filter-group',
  templateUrl: './filter-group.html',
  styleUrl: './filter-group.scss',
  host: {
    role: 'group',
    '[attr.aria-labelledby]': 'labelId'
  }
})
export class FilterGroup {
  readonly label = input.required<string>();

  protected readonly labelId = `filter-group-label-${nextId++}`;
}
