import { Component, input, output } from '@angular/core';

export interface SegmentedControlOption<T> {
  id: T;
  label: string;
}

/**
 * Selezione singola fra poche opzioni, sempre una attiva (radio-like).
 *
 * Non gestisce la selezione multipla: quella è `ToggleButtonGroup`, un
 * componente separato perché il contratto di `value`/evento cambia forma, non
 * solo comportamento (docs/architecture/frontend-shared-components-proposal.md,
 * §16.2). Non inietta nulla: riceve le opzioni e il valore corrente, segnala
 * l'intenzione di cambiarlo.
 */
@Component({
  selector: 'app-segmented-control',
  templateUrl: './segmented-control.html',
  styleUrl: './segmented-control.scss',
  host: {
    role: 'group',
    '[attr.aria-label]': 'ariaLabel()'
  }
})
export class SegmentedControl<T> {
  readonly options = input.required<readonly SegmentedControlOption<T>[]>();
  readonly value = input.required<T>();
  readonly ariaLabel = input.required<string>();

  readonly valueChange = output<T>();
}
