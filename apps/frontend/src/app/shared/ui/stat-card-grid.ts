import { Component, input } from '@angular/core';

export interface StatCardItem {
  label: string;
  value: string;
  tone?: 'positive' | 'negative' | 'neutral';
}

/**
 * Griglia responsive di indicatori KPI (etichetta + valore, tono opzionale).
 *
 * Solo rendering: chi la usa calcola già `items` come vettore di dati puri,
 * senza logica di dominio nel componente.
 */
@Component({
  selector: 'app-stat-card-grid',
  templateUrl: './stat-card-grid.html',
  styleUrl: './stat-card-grid.scss'
})
export class StatCardGrid {
  readonly items = input.required<readonly StatCardItem[]>();
}
