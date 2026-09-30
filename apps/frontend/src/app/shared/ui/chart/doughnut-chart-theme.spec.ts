/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seriesColorToken } from './chart-theme';
import { CHART_SERIES_COLORS } from './chart.model';
import {
  DOUGHNUT_CHART_GEOMETRY,
  DOUGHNUT_CHART_TOKENS,
  resolveDoughnutChartTheme,
} from './doughnut-chart-theme';

function fakeStyle(valori: Record<string, string>): Pick<CSSStyleDeclaration, 'getPropertyValue'> {
  return { getPropertyValue: (nome: string) => valori[nome] ?? '' };
}

describe('resolveDoughnutChartTheme', () => {
  it('risolve e ripulisce il bordo delle fette e i colori-serie', () => {
    const valori: Record<string, string> = { '--color-surface': ' rgb(7, 8, 9) ' };
    for (const colore of CHART_SERIES_COLORS) {
      valori[`--color-${colore}`] = `rgb(${colore})`;
    }
    const tema = resolveDoughnutChartTheme(fakeStyle(valori));
    expect(tema.sliceBorder).toBe('rgb(7, 8, 9)');
    for (const colore of CHART_SERIES_COLORS) {
      expect(tema.series[colore]).toBe(`rgb(${colore})`);
    }
  });

  it('con token assenti non inventa nulla: stringhe vuote', () => {
    const tema = resolveDoughnutChartTheme(fakeStyle({}));
    expect(tema.sliceBorder).toBe('');
    expect(tema.series['chart-1']).toBe('');
  });

  it('il padding del layout uguaglia lo scarto dell\'hover', () => {
    expect(DOUGHNUT_CHART_GEOMETRY.layoutPadding).toBe(DOUGHNUT_CHART_GEOMETRY.hoverOffset);
  });
});

describe('token del tema della ciambella', () => {
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
    ...Object.values(DOUGHNUT_CHART_TOKENS),
    ...CHART_SERIES_COLORS.map(seriesColorToken),
  ];

  it('trova entrambe le palette nel sorgente', () => {
    expect(iDark).toBeGreaterThanOrEqual(0);
    expect(iLight).toBeGreaterThan(iDark);
  });

  for (const [tema, testo] of Object.entries(palette)) {
    it(`ogni token usato è dichiarato nella palette ${tema}`, () => {
      for (const nome of nomi) {
        expect(testo, nome).toMatch(new RegExp(`${nome}\s*:`));
      }
    });
  }
});
