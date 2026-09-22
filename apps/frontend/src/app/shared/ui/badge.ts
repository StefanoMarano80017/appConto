import { Component, input } from '@angular/core';

/**
 * Pillola di stato testuale.
 *
 * `tone` copre solo i due valori realmente osservati (stato prestito aperto/
 * chiuso): nessun terzo tono "neutral" è stato aggiunto senza un uso reale.
 */
@Component({
  selector: 'app-badge',
  templateUrl: './badge.html',
  styleUrl: './badge.scss'
})
export class Badge {
  readonly label = input.required<string>();
  readonly tone = input.required<'positive' | 'negative'>();
}
