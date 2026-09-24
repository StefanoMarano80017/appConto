import { Component, input } from '@angular/core';
import { Amount, AmountTone } from '../ui/amount';

/**
 * Una card della griglia KPI.
 *
 * Unione discriminata e non due campi opzionali: con due opzionali il
 * compilatore non impedirebbe di passarli entrambi, né di non passarne
 * nessuno. Angular restringe l'unione discriminata nei template, quindi
 * `@if (item.kind === 'amount')` dà il tipo giusto in entrambi i rami.
 */
export type StatCardItem =
  | {
      /** Un importo in euro: lo rende `Amount`, con segno, mono e cifre tabulari. */
      readonly kind: 'amount';
      readonly label: string;
      readonly value: number;
      readonly tone?: AmountTone;
    }
  | {
      /** Un valore che importo non è: un conteggio, una data, un'etichetta. */
      readonly kind: 'text';
      readonly label: string;
      readonly value: string;
    };

/**
 * Griglia responsive di indicatori KPI (etichetta + valore).
 *
 * Solo rendering: chi la usa calcola già `items`, senza logica di dominio nel
 * componente. Una card `amount` delega interamente ad `Amount` — segno, mono,
 * cifre tabulari e colore del tono sono suoi, non di questa griglia; una card
 * `text` resta un conteggio o un'etichetta, e non deve ricevere né l'uno né
 * gli altri.
 */
@Component({
  selector: 'app-stat-card-grid',
  imports: [Amount],
  templateUrl: './stat-card-grid.html',
  styleUrl: './stat-card-grid.scss'
})
export class StatCardGrid {
  readonly items = input.required<readonly StatCardItem[]>();
}
