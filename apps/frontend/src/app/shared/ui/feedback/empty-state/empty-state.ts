import { Component, input, output } from '@angular/core';

/**
 * Messaggio "nessun risultato", con hint e azione opzionali.
 *
 * Il pulsante azione compare solo se `actionLabel` è passato. L'host è
 * `display: contents`: gli elementi restano fratelli diretti nel flusso della
 * pagina ospitante, come lo erano scritti a mano.
 */
@Component({
  selector: 'app-empty-state',
  templateUrl: './empty-state.html',
  styleUrl: './empty-state.scss'
})
export class EmptyState {
  readonly message = input.required<string>();
  readonly hint = input<string | undefined>(undefined);
  readonly actionLabel = input<string | undefined>(undefined);

  readonly action = output<void>();
}
