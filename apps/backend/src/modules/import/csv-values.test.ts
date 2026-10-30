import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCsvAmount, parseCsvDate } from './csv-values.js';

const dateCases: Array<[string, string | null]> = [
  ['31/12/2025', '2025-12-31'],
  ['31-12-2025', '2025-12-31'],
  ['31.12.2025', '2025-12-31'],
  ['2025-12-31', '2025-12-31'],
  ['31/12/2025 10:30', '2025-12-31'],
  ['31/12/2025 10:30:15', '2025-12-31'],
  ['2025-12-31T10:30:00', '2025-12-31'],
  ['2025-12-31 10:30', '2025-12-31'],
  ['1/2/2026', '2026-02-01'],
  ['29/02/2024', '2024-02-29'],
  ['29/02/2025', null],
  ['32/13/2026', null],
  ['2025-12-31xyz', null],
  ['', null],
  ['31/12/25', '2025-12-31'],
  ['01/01/99', '1999-01-01'],
  ['01/01/69', '2069-01-01'],
];

const amountCases: Array<[string, number | null]> = [
  ['-54,30', -54.3],
  ['-54.30', -54.3],
  ['2.450,00', 2450],
  ['1.234', 1234],
  ['1,234', 1.234],
  ['1,234,567', 1234567],
  ['1.234.567,89', 1234567.89],
  ['1,234,567.89', 1234567.89],
  ['1 234,56', 1234.56],
  ['€ 12,00', 12],
  ['12,00 €', 12],
  ['12,50 EUR', 12.5],
  ['EUR -12,50', -12.5],
  ['120,00-', -120],
  ['120,00+', 120],
  ['+120,00', 120],
  ['-120,00-', null],
  ['(12,50)', null],
  ['', null],
  ['abc', null],
];

describe('parseCsvDate', () => {
  for (const [input, expected] of dateCases) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(parseCsvDate(input), expected);
    });
  }
});

describe('parseCsvAmount', () => {
  for (const [input, expected] of amountCases) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(parseCsvAmount(input), expected);
    });
  }
});

/** Formatta i centesimi all'italiana: migliaia `.`, decimali `,`, sempre due decimali. */
function formatItalian(cents: number): string {
  const abs = Math.abs(cents);
  const integer = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimals = String(abs % 100).padStart(2, '0');

  return `${cents < 0 ? '-' : ''}${integer},${decimals}`;
}

describe('importo: andata e ritorno', () => {
  it("ogni importo da -1.000.000 a +1.000.000 centesimi formattato all'italiana torna identico", () => {
    const failures: string[] = [];
    for (let cents = -1_000_000; cents <= 1_000_000; cents += 1) {
      const text = formatItalian(cents);
      const parsed = parseCsvAmount(text);
      if (parsed === null || Math.round(parsed * 100) !== cents) {
        failures.push(`${cents} -> ${JSON.stringify(text)} -> ${parsed}`);
        if (failures.length >= 20) break;
      }
    }

    assert.deepEqual(failures, []);
  });
});
