/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LINE_CHART_FONT_PREFIXES,
  LINE_CHART_TOKENS,
  resolveLineChartTheme,
  seriesColorToken,
} from './line-chart-theme';
import { CHART_SERIES_COLORS } from './line-chart.model';

function fakeStyle(valori: Record<string, string>): Pick<CSSStyleDeclaration, 'getPropertyValue'> {
  return { getPropertyValue: (nome: string) => valori[nome] ?? '' };
}

describe('resolveLineChartTheme', () => {
  const valori: Record<string, string> = {
    '--color-text-muted': ' rgb(1, 2, 3) ',
    '--color-border': 'rgb(4, 5, 6)',
    '--color-surface': 'rgb(7, 8, 9)',
    '--color-primary': 'rgb(10, 11, 12)',
    '--color-border-strong': 'rgb(13, 14, 15)',
    '--chart-label-font-family': ' Geist, sans-serif ',
    '--chart-label-font-size': '13px',
    '--chart-label-font-weight': '400',
    '--chart-value-font-family': 'Geist Mono',
    '--chart-value-font-size': '15.5px',
    '--chart-value-font-weight': '500',
  };
  for (const colore of CHART_SERIES_COLORS) {
    valori[`--color-${colore}`] = `rgb(${colore})`;
  }

  it('risolve e ripulisce i colori', () => {
    const tema = resolveLineChartTheme(fakeStyle(valori));
    expect(tema.axisText).toBe('rgb(1, 2, 3)');
    expect(tema.guideHover).toBe('rgb(1, 2, 3)');
    expect(tema.grid).toBe('rgb(4, 5, 6)');
    expect(tema.hollowFill).toBe('rgb(7, 8, 9)');
    expect(tema.guideSelected).toBe('rgb(10, 11, 12)');
    expect(tema.zeroLine).toBe('rgb(13, 14, 15)');
  });

  it('risolve tutti i colori-serie', () => {
    const tema = resolveLineChartTheme(fakeStyle(valori));
    for (const colore of CHART_SERIES_COLORS) {
      expect(tema.series[colore]).toBe(`rgb(${colore})`);
    }
  });

  it('interpreta i due ruoli tipografici', () => {
    const tema = resolveLineChartTheme(fakeStyle(valori));
    expect(tema.labelFont).toEqual({ family: 'Geist, sans-serif', size: 13, weight: 400 });
    expect(tema.valueFont).toEqual({ family: 'Geist Mono', size: 15.5, weight: 500 });
  });

  it('con valori assenti non inventa nulla: stringhe vuote e numeri undefined', () => {
    const tema = resolveLineChartTheme(fakeStyle({}));
    expect(tema.axisText).toBe('');
    expect(tema.series['chart-1']).toBe('');
    expect(tema.labelFont).toEqual({ family: '', size: undefined, weight: undefined });
    expect(tema.valueFont.size).toBeUndefined();
  });

  it('scarta i numeri non interpretabili invece di produrre NaN', () => {
    const tema = resolveLineChartTheme(fakeStyle({ '--chart-label-font-size': 'large' }));
    expect(tema.labelFont.size).toBeUndefined();
  });
});

describe('token del tema del grafico', () => {
  const qui = dirname(fileURLToPath(import.meta.url));
  const sorgente = readFileSync(join(qui, '../../styles/_primitives.scss'), 'utf8');
  // Le due palette sono mixin distinti: si verifica ciascuna, non la loro unione.
  const iDark = sorgente.indexOf('@mixin dark-palette');
  const iLight = sorgente.indexOf('@mixin light-palette');
  const palette = {
    dark: sorgente.slice(iDark, iLight),
    light: sorgente.slice(iLight),
  };

  const nomi = [
    ...Object.values(LINE_CHART_TOKENS),
    ...CHART_SERIES_COLORS.map(seriesColorToken),
  ];

  it('trova entrambe le palette nel sorgente', () => {
    expect(iDark).toBeGreaterThanOrEqual(0);
    expect(iLight).toBeGreaterThan(iDark);
  });

  for (const [tema, testo] of Object.entries(palette)) {
    it(`ogni token usato è dichiarato nella palette ${tema}`, () => {
      for (const nome of nomi) {
        expect(testo, nome).toMatch(new RegExp(`${nome}\\s*:`));
      }
    });
  }

  it('i prefissi tipografici sono i due ruoli attesi', () => {
    expect(LINE_CHART_FONT_PREFIXES).toEqual({ label: 'chart-label', value: 'chart-value' });
  });
});
