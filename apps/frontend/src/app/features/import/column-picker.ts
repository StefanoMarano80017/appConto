import { Component, input, output } from '@angular/core';
import {
  ColumnMappingErrors,
  ColumnMappingFormValue,
  CsvAnalysis,
  sampleValue
} from './column-mapping';

/**
 * Le tendine con cui l'utente indica le colonne del file.
 *
 * Non possiede stato: riceve la scelta corrente e ne emette una nuova. La
 * pagina resta l'unica a sapere se si sta importando in automatico o a mano.
 *
 * Accanto a ogni tendina compare un valore d'esempio preso dal file: è quello
 * che permette di riconoscere la colonna giusta quando l'intestazione non dice
 * niente — ed è esattamente il caso in cui si arriva qui.
 */
@Component({
  selector: 'app-column-picker',
  templateUrl: './column-picker.html',
  styleUrl: './column-picker.scss'
})
export class ColumnPicker {
  readonly analysis = input.required<CsvAnalysis>();
  readonly form = input.required<ColumnMappingFormValue>();
  readonly errors = input.required<ColumnMappingErrors>();
  readonly changed = output<ColumnMappingFormValue>();

  /** Primo valore non vuoto della colonna, fra le righe dell'anteprima. */
  protected example(column: string): string {
    return column === '' ? '' : sampleValue(this.analysis(), column);
  }

  protected update<K extends keyof ColumnMappingFormValue>(
    field: K,
    value: ColumnMappingFormValue[K]
  ): void {
    this.changed.emit({ ...this.form(), [field]: value });
  }
}
