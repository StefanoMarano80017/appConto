import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toAmountCents } from './transaction.model.js';

const MAX_CENTS = 1_000_000;

describe('toAmountCents', () => {
  describe('tabella', () => {
    const cases: ReadonlyArray<readonly [string, number, number]> = [
      ['1.005 arrotonda a metà verso l\'alto', 1.005, 101],
      ['0.285 arrotonda a metà verso l\'alto', 0.285, 29],
      ['-1.005 è simmetrico a 1.005', -1.005, -101],
      ['un importo intero', 2450, 245000],
      ['la somma 0.1 + 0.2 vale 30 centesimi', 0.1 + 0.2, 30],
    ];

    for (const [name, input, expected] of cases) {
      it(name, () => {
        assert.equal(toAmountCents(input), expected);
      });
    }

    it('-0.004 dà 0 positivo, non -0', () => {
      assert.ok(Object.is(toAmountCents(-0.004), 0));
    });
  });

  describe('a metà, simmetria', () => {
    it('0.005 dà 1 e -0.005 dà -1', () => {
      assert.equal(toAmountCents(0.005), 1);
      assert.equal(toAmountCents(-0.005), -1);
    });

    for (const half of [0.005, 1.005, 2.675]) {
      it(`toAmountCents(-${half}) è l'opposto di toAmountCents(${half})`, () => {
        assert.equal(toAmountCents(-half), -toAmountCents(half));
      });
    }
  });

  describe('niente -0', () => {
    for (const input of [0, -0, -0.004, 0.004, -0.0049]) {
      it(`${Object.is(input, -0) ? '-0' : input} dà 0 positivo`, () => {
        assert.ok(Object.is(toAmountCents(input), 0));
      });
    }

    it('il -0 letto da un CSV ("-0,00") non arriva in archivio come centesimi', () => {
      assert.ok(Object.is(toAmountCents(-0), 0));
    });
  });

  describe('notazione esponenziale', () => {
    it('1e-7 dà 0 positivo, non NaN', () => {
      assert.ok(Object.is(toAmountCents(1e-7), 0));
    });

    it('-1e-7 dà 0 positivo, non NaN', () => {
      assert.ok(Object.is(toAmountCents(-1e-7), 0));
    });

    it('un importo grande resta esatto', () => {
      assert.equal(toAmountCents(123456789.12), 12345678912);
      assert.equal(toAmountCents(-123456789.12), -12345678912);
    });

    it('un importo oltre 1e21 non dà NaN', () => {
      assert.ok(Number.isFinite(toAmountCents(1e21)));
    });
  });

  describe('invarianti su ±1.000.000 centesimi', () => {
    it('andata e ritorno: toAmountCents(c / 100) === c', () => {
      for (let c = -MAX_CENTS; c <= MAX_CENTS; c += 1) {
        assert.equal(toAmountCents(c / 100), c);
      }
    });

    it('stabilità delle impronte: coincide con la vecchia formula Math.round(x * 100)', () => {
      for (let c = -MAX_CENTS; c <= MAX_CENTS; c += 1) {
        const amount = c / 100;
        assert.equal(toAmountCents(amount), Math.round(amount * 100));
      }
    });

    it('simmetria: toAmountCents(-x) === -toAmountCents(x) per ogni x non nullo', () => {
      for (let c = 1; c <= MAX_CENTS; c += 1) {
        const amount = c / 100;
        assert.equal(toAmountCents(-amount), -toAmountCents(amount));
      }
    });
  });
});
