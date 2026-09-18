import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from '../../shared/errors.js';
import {
  bindingFromMapping,
  columnMappingSchema,
  toProposal,
  type ColumnMapping,
} from './column-mapping.js';
import { detectColumns } from './csv-column-detector.js';
import { parseCsv } from './csv-parser.js';
import { mapRowsToTransactions } from './csv-transaction-mapper.js';

const HEADERS = ['F1', 'F2', 'F3', 'F4'];

const mapping = (overrides: Partial<ColumnMapping> = {}): ColumnMapping => ({
  bookingDate: 'F4',
  description: 'F3',
  amount: { kind: 'single', column: 'F2' },
  typeHint: null,
  ...overrides,
});

describe('scelta manuale delle colonne', () => {
  it('legge il file con le colonne indicate dall\'utente', () => {
    // Intestazioni anonime e nell'ordine sbagliato: il rilevamento automatico
    // qui non ha nulla su cui appoggiarsi, la scelta dell'utente sì.
    const { rows } = parseCsv(
      [
        'F1;F2;F3;F4',
        'riga;-12,50;FARMACIA COMUNALE;10/03/2026',
        'riga;1.200,00;RIMBORSO ASSICURAZIONE;12/03/2026',
      ].join('\n'),
    );

    const { transactions, errors } = mapRowsToTransactions(
      bindingFromMapping(mapping(), HEADERS),
      rows,
    );

    assert.deepEqual(errors, []);
    assert.deepEqual(
      transactions.map((t) => [t.bookingDate, t.description, t.amount, t.type]),
      [
        ['2026-03-10', 'FARMACIA COMUNALE', -12.5, 'EXPENSE'],
        ['2026-03-12', 'RIMBORSO ASSICURAZIONE', 1200, 'INCOME'],
      ],
    );
  });

  it('accetta le uscite e le entrate su due colonne', () => {
    const { rows } = parseCsv(
      ['A;B;C;D', '10/03/2026;SPESA;12,50;', '12/03/2026;STIPENDIO;;1.200,00'].join('\n'),
    );

    const binding = bindingFromMapping(
      {
        bookingDate: 'A',
        description: 'B',
        amount: { kind: 'debitCredit', debit: 'C', credit: 'D' },
        typeHint: null,
      },
      ['A', 'B', 'C', 'D'],
    );

    assert.deepEqual(
      mapRowsToTransactions(binding, rows).transactions.map((t) => t.amount),
      [-12.5, 1200],
    );
  });

  it('rifiuta una colonna che non esiste nel file, dicendo per quale campo', () => {
    assert.throws(
      () => bindingFromMapping(mapping({ description: 'Inesistente' }), HEADERS),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.match(error.message, /Inesistente/);
        assert.match(error.message, /descrizione/);
        return true;
      },
    );
  });

  it('rifiuta uscite ed entrate nella stessa colonna', () => {
    assert.throws(
      () =>
        bindingFromMapping(
          mapping({ amount: { kind: 'debitCredit', debit: 'F2', credit: 'F2' } }),
          HEADERS,
        ),
      ValidationError,
    );
  });

  it('la colonna del tipo è facoltativa', () => {
    assert.deepEqual(bindingFromMapping(mapping(), HEADERS).typeHint, []);
    assert.deepEqual(bindingFromMapping(mapping({ typeHint: 'F1' }), HEADERS).typeHint, ['F1']);
  });
});

describe('validazione della richiesta manuale', () => {
  it('rifiuta un campo obbligatorio mancante', () => {
    const result = columnMappingSchema.safeParse({
      bookingDate: 'F4',
      description: 'F3',
      typeHint: null,
    });

    assert.equal(result.success, false);
  });

  it('rifiuta un nome di colonna vuoto', () => {
    const result = columnMappingSchema.safeParse(mapping({ description: '   ' }));

    assert.equal(result.success, false);
  });

  it('accetta la scelta completa', () => {
    assert.equal(columnMappingSchema.safeParse(mapping()).success, true);
  });
});

describe('proposta del rilevamento', () => {
  it('ha la stessa forma della scelta manuale, così la modalità manuale ne parte', () => {
    const { headers, rows } = parseCsv(
      [
        'Data contabile;Descrizione;Importo',
        '02/01/2026;SPESA SUPERMERCATO;-54,30',
        '05/01/2026;STIPENDIO GENNAIO;2.450,00',
      ].join('\n'),
    );

    const proposal = toProposal(detectColumns(headers, rows));

    assert.deepEqual(proposal, {
      bookingDate: 'Data contabile',
      description: 'Descrizione',
      amount: { kind: 'single', column: 'Importo' },
      typeHint: null,
    });
    // La proposta, così com'è, è una scelta manuale valida.
    assert.equal(columnMappingSchema.safeParse(proposal).success, true);
  });

  it('riporta a null il campo non riconosciuto', () => {
    const { headers, rows } = parseCsv(
      ['Descrizione;Note', 'SPESA SUPERMERCATO;prima', 'EDICOLA;seconda'].join('\n'),
    );

    const proposal = toProposal(detectColumns(headers, rows));

    assert.equal(proposal.bookingDate, null);
    assert.equal(proposal.amount, null);
  });
});
