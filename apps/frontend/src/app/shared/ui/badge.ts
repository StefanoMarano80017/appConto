import { Component, input } from '@angular/core';

/**
 * Pillola di stato testuale.
 *
 * `tone` copriva solo i due valori dello stato prestito aperto/chiuso finché
 * non è arrivato un uso reale del terzo: un conteggio di filtri attivi non è
 * né positivo né negativo, quindi 'neutral' esiste da quando serve a questo.
 */
@Component({
  selector: 'app-badge',
  templateUrl: './badge.html',
  styleUrl: './badge.scss'
})
export class Badge {
  readonly label = input.required<string>();
  readonly tone = input.required<'positive' | 'negative' | 'neutral'>();
}
