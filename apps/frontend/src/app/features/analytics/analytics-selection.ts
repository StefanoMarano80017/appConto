import { Injectable, Signal, signal } from '@angular/core';
import { DateRange } from '../../core/period';
import { TransactionQueryState } from '../transactions/transaction-query';
import { Analytics, TimelineGranularity } from './analytics.model';

/**
 * L'elemento di un grafico a cui il pannello restringe le transazioni.
 *
 * Solo bucket e categorie: il click su un merchant non seleziona, porta ancora
 * ai suoi movimenti in Movimenti (`AnalyticsPage.onMerchantSelected`).
 */
export type AnalyticsSelectionValue =
  | {
      kind: 'period';
      granularity: TimelineGranularity;
      period: string;
      range: DateRange;
      label: string;
    }
  | { kind: 'category'; categoryId: string | null; name: string };

/**
 * L'elemento del grafico selezionato.
 *
 * Non sta in `AnalyticsStore`: lo store resta piccolo e descrive che cosa si
 * analizza, mentre la selezione è stato di vista, non un criterio dell'analisi.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsSelection {
  private readonly selectionState = signal<AnalyticsSelectionValue | null>(null);

  readonly selection: Signal<AnalyticsSelectionValue | null> = this.selectionState.asReadonly();

  select(value: AnalyticsSelectionValue): void {
    this.selectionState.set(value);
  }

  clear(): void {
    this.selectionState.set(null);
  }
}

/** I criteri che isolano le transazioni dell'elemento, sopra quelli dell'analisi. */
export function selectionCriteria(
  selection: AnalyticsSelectionValue
): Partial<TransactionQueryState> {
  switch (selection.kind) {
    case 'period':
      return { from: selection.range.from, to: selection.range.to };
    case 'category':
      // La distribuzione per categoria conta solo le spese.
      return selection.categoryId === null
        ? { classification: 'unclassified', types: ['EXPENSE'] }
        : { categoryIds: [selection.categoryId], types: ['EXPENSE'] };
  }
}

/** Vera se l'elemento è ancora presente nei dati: altrimenti la selezione è caduta. */
export function isSelectionAvailable(
  selection: AnalyticsSelectionValue,
  data: Analytics
): boolean {
  switch (selection.kind) {
    case 'period':
      return (
        data.timeline.granularity === selection.granularity &&
        data.timeline.buckets.some((bucket) => bucket.period === selection.period)
      );
    case 'category':
      return data.byCategory.some((entry) => entry.categoryId === selection.categoryId);
  }
}

/** Il testo dopo «Transazioni · ». */
export function selectionLabel(selection: AnalyticsSelectionValue): string {
  switch (selection.kind) {
    case 'period':
      return selection.label;
    case 'category':
      return selection.categoryId === null ? 'Da classificare' : selection.name;
  }
}
