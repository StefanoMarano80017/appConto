import { TestBed } from '@angular/core/testing';
import { Analytics } from './analytics.model';
import {
  AnalyticsSelection,
  AnalyticsSelectionValue,
  isSelectionAvailable,
  selectionCriteria,
  selectionLabel
} from './analytics-selection';

const WEEK: AnalyticsSelectionValue = {
  kind: 'period',
  granularity: 'week',
  period: '2026-07-06',
  range: { from: '2026-07-06', to: '2026-07-12' },
  label: '6–12 lug 2026'
};

const category = (categoryId: string | null, name = 'Spesa'): AnalyticsSelectionValue => ({
  kind: 'category',
  categoryId,
  name
});

/** Il minimo che serve a stabilire se un elemento esiste ancora nei grafici. */
const analytics = (withUnclassified = true): Analytics =>
  ({
    byCategory: [
      { categoryId: 'cat-1', name: 'Spesa' },
      ...(withUnclassified ? [{ categoryId: null, name: 'Da classificare' }] : [])
    ],
    timeline: {
      granularity: 'week',
      buckets: [{ period: '2026-07-06' }]
    }
  }) as unknown as Analytics;

describe('AnalyticsSelection', () => {
  it('parte senza selezione', () => {
    expect(TestBed.inject(AnalyticsSelection).selection()).toBeNull();
  });

  it('select memorizza il valore e clear lo toglie', () => {
    const service = TestBed.inject(AnalyticsSelection);

    service.select(WEEK);
    expect(service.selection()).toEqual(WEEK);

    service.clear();
    expect(service.selection()).toBeNull();
  });
});

describe('selectionCriteria', () => {
  it('un periodo diventa il suo intervallo di date', () => {
    expect(selectionCriteria(WEEK)).toEqual({ from: '2026-07-06', to: '2026-07-12' });
  });

  it('una categoria diventa il filtro per categoria sulle sole spese', () => {
    expect(selectionCriteria(category('cat-1'))).toEqual({
      categoryIds: ['cat-1'],
      types: ['EXPENSE']
    });
  });

  it('la categoria nulla diventa il filtro "da classificare" sulle sole spese', () => {
    expect(selectionCriteria(category(null))).toEqual({
      classification: 'unclassified',
      types: ['EXPENSE']
    });
  });
});

describe('isSelectionAvailable', () => {
  it('è vera per un periodo e una categoria presenti', () => {
    expect(isSelectionAvailable(WEEK, analytics())).toBe(true);
    expect(isSelectionAvailable(category('cat-1'), analytics())).toBe(true);
  });

  it('è falsa per un periodo che non è tra i bucket', () => {
    expect(isSelectionAvailable({ ...WEEK, period: '2026-07-13' } as AnalyticsSelectionValue, analytics())).toBe(
      false
    );
  });

  it('è falsa per lo stesso bucket con un altro passo', () => {
    expect(isSelectionAvailable({ ...WEEK, granularity: 'month' } as AnalyticsSelectionValue, analytics())).toBe(
      false
    );
  });

  it('è falsa per una categoria assente', () => {
    expect(isSelectionAvailable(category('cat-2'), analytics())).toBe(false);
  });

  it('la categoria nulla è disponibile solo se esiste la voce nulla', () => {
    expect(isSelectionAvailable(category(null), analytics(true))).toBe(true);
    expect(isSelectionAvailable(category(null), analytics(false))).toBe(false);
  });
});

describe('selectionLabel', () => {
  it('per un periodo è la sua etichetta', () => {
    expect(selectionLabel(WEEK)).toBe('6–12 lug 2026');
  });

  it('per una categoria è il nome, o "Da classificare" se nulla', () => {
    expect(selectionLabel(category('cat-1', 'Spesa'))).toBe('Spesa');
    expect(selectionLabel(category(null, 'Altro'))).toBe('Da classificare');
  });
});
