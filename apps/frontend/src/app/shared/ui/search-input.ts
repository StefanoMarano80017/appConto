import { Component, input, output } from '@angular/core';
import { LucideSearch } from '@lucide/angular';

/**
 * Campo di ricerca, con icona di lente sempre presente.
 *
 * Solo presentazione: riceve il testo corrente ed emette quello digitato. La
 * pagina resta responsabile del debounce o del filtro applicato.
 */
@Component({
  selector: 'app-search-input',
  imports: [LucideSearch],
  templateUrl: './search-input.html',
  styleUrl: './search-input.scss'
})
export class SearchInput {
  readonly value = input.required<string>();
  readonly placeholder = input.required<string>();
  readonly ariaLabel = input<string | undefined>(undefined);

  readonly valueChange = output<string>();
}
