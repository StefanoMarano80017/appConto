import { Component, input, linkedSignal } from '@angular/core';
import { LucideChevronDown, LucideChevronUp } from '@lucide/angular';
import { Badge } from './badge';

let nextId = 0;

/**
 * Una sezione collassabile della toolbox: titolo cliccabile più il controllo
 * che governa.
 *
 * È il mattone che rende le toolbox identiche fra viste, come
 * DESIGN_SYSTEM.md §6 richiede: cambia il contenuto, non la forma. Oggi lo
 * stesso concetto esiste in tre forme diverse (un `h3` in Analytics, un
 * `<details>` in Movimenti, niente affatto in Dashboard).
 *
 * Non sa cosa sia il controllo che contiene: lo proietta e basta. Il nome
 * accessibile della sezione lo porta la region (`role="region"` più
 * `aria-labelledby` verso il bottone che la apre), non l'host: un
 * `role="group"` sull'host duplicherebbe lo stesso annuncio in un contenitore
 * annidato che non aggiunge informazione.
 *
 * Il contenuto proiettato si nasconde con `[hidden]`, non con `@if`: un
 * `@if` distruggerebbe e ricreerebbe i controlli a ogni chiusura, perdendo
 * per esempio il testo digitato nella ricerca merchant.
 *
 * L'id è generato una sola volta per istanza (contatore di modulo), non a
 * ogni change detection. Serve ora per due id, non uno: il bottone e la
 * region che descrive.
 */
@Component({
  selector: 'app-filter-group',
  imports: [Badge, LucideChevronDown, LucideChevronUp],
  templateUrl: './filter-group.html',
  styleUrl: './filter-group.scss',
})
export class FilterGroup {
  readonly label = input.required<string>();
  readonly count = input(0);
  readonly initiallyOpen = input(false);

  /** L'input può aprire la sezione, ma la sua disattivazione non la richiude. */
  protected readonly open = linkedSignal({
    source: () => this.initiallyOpen(),
    computation: (initiallyOpen, previous) => initiallyOpen || previous?.value === true,
  });

  private readonly id = nextId++;
  protected readonly buttonId = `filter-group-button-${this.id}`;
  protected readonly panelId = `filter-group-panel-${this.id}`;
}
