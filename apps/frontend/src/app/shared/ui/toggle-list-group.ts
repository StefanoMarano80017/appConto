import { Component, computed, input, output, signal } from '@angular/core';
import { SearchInput } from './search-input';

const MAX_LABEL_LENGTH = 25;

export interface ToggleButtonOption<T> {
  id: T;
  label: string;
}

/**
 * Selezione multipla fra poche opzioni, zero o più attive (checkbox-like).
 *
 * Non calcola da sé il nuovo array selezionato: emette solo l'id su cui è
 * stato fatto clic, e lascia alla pagina decidere come aggiornare il proprio
 * stato — nel caso reale che migra in questo PoC lo stato vive in uno store
 * di feature (`AnalyticsStore.toggleType`) che già accetta un id singolo, non
 * un array sostitutivo. Centralizzare il calcolo dell'array dentro il
 * componente, come ipotizzato nella proposta originale, avrebbe richiesto
 * cambiare l'API dello store: rimandato a quando la migrazione di massa
 * (Fase 3) toccherà tutti gli usi insieme
 * (docs/architecture/frontend-shared-components-proposal.md, §16.2).
 */
@Component({
  selector: 'app-toggle-list-group',
  imports: [SearchInput],
  templateUrl: './toggle-list-group.html',
  styleUrl: './toggle-list-group.scss',
  host: {
    role: 'group',
    '[attr.aria-label]': 'ariaLabel()',
  },
})
export class ToggleListGroup<T> {
  readonly options = input.required<readonly ToggleButtonOption<T>[]>();
  readonly value = input.required<readonly T[]>();
  /** Senza, chi usa uno screen reader sente una fila di interruttori senza sapere di che criterio sono. */
  readonly ariaLabel = input.required<string>();
  readonly searchPlaceholder = input('Cerca...');
  readonly searchAriaLabel = input.required<string>();
  readonly noResultsMessage = input('Nessuna opzione corrisponde alla ricerca.');
  readonly maxOptions = input<number | null>(null);

  readonly toggled = output<T>();

  protected readonly searchTerm = signal('');
  protected readonly visibleOptions = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    const matchingOptions =
      query === ''
        ? this.options()
        : this.options().filter((option) => option.label.toLowerCase().includes(query));
    const maxOptions = this.maxOptions();

    return maxOptions === null ? matchingOptions : matchingOptions.slice(0, maxOptions);
  });

  protected displayLabel(label: string): string {
    const characters = Array.from(label);
    if (characters.length <= MAX_LABEL_LENGTH) {
      return label;
    }

    return `${characters.slice(0, MAX_LABEL_LENGTH - 3).join('')}...`;
  }
}
