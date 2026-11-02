import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveTransactionType } from './transaction-type-resolver.js';

/*
 * Tabella delle diciture della banca. Ogni riga è un caso: il nome del test
 * riporta input e atteso, così un fallimento dice subito quale dicitura sbaglia.
 */
const cases: Array<{ hint: string; amount: number; expected: string }> = [
  { hint: 'PRELIEVO BANCOMAT', amount: -50, expected: 'WITHDRAWAL' },
  { hint: 'Prelievi contanti', amount: -50, expected: 'WITHDRAWAL' },
  { hint: 'Prelevamento', amount: -50, expected: 'WITHDRAWAL' },
  // Voluto: lo storno di un prelievo è un prelievo al netto, e la dashboard lo sottrae.
  { hint: 'STORNO PRELIEVO', amount: 50, expected: 'WITHDRAWAL' },
  { hint: 'ACCREDITO STIPENDIO', amount: 1000, expected: 'INCOME' },
  { hint: 'Accrediti vari', amount: 10, expected: 'INCOME' },
  // Fissato: la dicitura di accredito prevale sul segno negativo.
  { hint: 'ACCREDITO', amount: -10, expected: 'INCOME' },
  { hint: '', amount: 0, expected: 'EXPENSE' },
  { hint: '', amount: 0.01, expected: 'INCOME' },
  { hint: 'POS', amount: -1, expected: 'EXPENSE' },
];

describe('tipo del movimento dalla dicitura della banca', () => {
  for (const { hint, amount, expected } of cases) {
    it(`dicitura '${hint}' con importo ${amount} produce ${expected}`, () => {
      assert.equal(resolveTransactionType(hint, amount), expected);
    });
  }
});
