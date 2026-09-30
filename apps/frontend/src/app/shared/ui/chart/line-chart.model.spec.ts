import { describe, expect, it } from 'vitest';
import { CHART_SERIES_COLORS, chartColorVar } from './line-chart.model';

describe('chartColorVar', () => {
  it('compone il riferimento CSS al colore-serie', () => {
    expect(chartColorVar('chart-3')).toBe('var(--color-chart-3)');
    expect(chartColorVar('chart-neutral')).toBe('var(--color-chart-neutral)');
  });

  it('copre tutti i colori-serie senza duplicati', () => {
    expect(new Set(CHART_SERIES_COLORS).size).toBe(CHART_SERIES_COLORS.length);
    expect(CHART_SERIES_COLORS).toHaveLength(8);
  });
});
