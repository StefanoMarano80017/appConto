import { Component, input, output } from '@angular/core';

/**
 * Messaggio d'errore con pulsante "Riprova".
 *
 * L'host è `display: contents`: i due elementi restano fratelli diretti nel
 * flusso della pagina ospitante, come lo erano scritti a mano.
 */
@Component({
  selector: 'app-error-retry',
  templateUrl: './error-retry.html',
  styleUrl: './error-retry.scss'
})
export class ErrorRetry {
  readonly message = input.required<string>();

  readonly retry = output<void>();
}
