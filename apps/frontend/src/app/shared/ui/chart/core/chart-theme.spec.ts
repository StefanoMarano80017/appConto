import { describe, expect, it } from 'vitest';
import { resolveSeriesColors, seriesColorToken } from './chart-theme';
import { CHART_SERIES_COLORS } from './chart.model';

function fakeStyle(valori: Record<string, string>): Pick<CSSStyleDeclaration, 'getPropertyValue'> {
  return { getPropertyValue: (nome: string) => valori[nome] ?? '' };
}

describe('resolveSeriesColors', () => {
  it('legge ogni colore-serie dal proprio token, ripulito', () => {
    const style = fakeStyle({ '--color-chart-1': ' #111 ', '--color-chart-neutral': '#999' });
    const colors = resolveSeriesColors(style);
    expect(colors['chart-1']).toBe('#111');
    expect(colors['chart-neutral']).toBe('#999');
  });
  it('un token mancante resta stringa vuota', () => {
    expect(resolveSeriesColors(fakeStyle({}))['chart-7']).toBe('');
  });
  it('copre esattamente CHART_SERIES_COLORS', () => {
    expect(Object.keys(resolveSeriesColors(fakeStyle({}))).sort()).toEqual(
      [...CHART_SERIES_COLORS].sort(),
    );
  });
});

it('seriesColorToken antepone --color-', () => {
  expect(seriesColorToken('chart-3')).toBe('--color-chart-3');
});
