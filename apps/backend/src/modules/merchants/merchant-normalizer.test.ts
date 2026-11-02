import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeMerchantName } from './merchant-normalizer.js';

describe('normalizzazione del nome del merchant', () => {
  it("'  Bar   X ' diventa 'bar x'", () => {
    assert.equal(normalizeMerchantName('  Bar   X '), 'bar x');
  });

  it("tabulazioni e a capo diventano uno spazio: 'BAR\\tX\\nY' diventa 'bar x y'", () => {
    assert.equal(normalizeMerchantName('BAR\tX\nY'), 'bar x y');
  });

  it("uno spazio misto a tabulazioni e a capo diventa uno solo: 'BAR \\t\\n X' diventa 'bar x'", () => {
    assert.equal(normalizeMerchantName('BAR \t\n X'), 'bar x');
  });

  it("le lettere accentate restano tali: 'CAFFÈ' diventa 'caffè'", () => {
    assert.equal(normalizeMerchantName('CAFFÈ'), 'caffè');
  });
});
