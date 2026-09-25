import { Component, input, output } from '@angular/core';

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
  selector: 'app-toggle-button-group',
  templateUrl: './toggle-button-group.html',
  styleUrl: './toggle-button-group.scss',
  host: {
    role: 'group',
    '[attr.aria-label]': 'ariaLabel()'
  }
})
export class ToggleButtonGroup<T> {
  readonly options = input.required<readonly ToggleButtonOption<T>[]>();
  readonly value = input.required<readonly T[]>();
  /** Senza, chi usa uno screen reader sente una fila di interruttori senza sapere di che criterio sono. */
  readonly ariaLabel = input.required<string>();

  readonly toggled = output<T>();
}
