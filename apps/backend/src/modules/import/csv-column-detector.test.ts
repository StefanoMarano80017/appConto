import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from '../../shared/errors.js';
import { bindingFromDetection, describeBinding } from './column-mapping.js';
import { detectColumns } from './csv-column-detector.js';
import { parseCsv } from './csv-parser.js';
import { mapRowsToTransactions } from './csv-transaction-mapper.js';

/** Legge un CSV come farebbe l'import automatico: rilevamento e conversione. */
const read = (content: string) => {
  const { headers, rows } = parseCsv(content);
  const binding = bindingFromDetection(detectColumns(headers, rows), headers);

  return { ...mapRowsToTransactions(binding, rows), binding };
};

const columnsOf = (content: string) => describeBinding(read(content).binding);

describe('riconoscimento delle colonne dal contenuto', () => {
  it('legge il formato con virgola, data italiana e importo con punto', () => {
    const { transactions, errors } = read(
      [
        'Data contabile,Descrizione,Importo',
        '02/01/2026,PAGAMENTO POS ESSELUNGA,-54.30',
        '05/01/2026,ACCREDITO STIPENDIO,2450.00',
      ].join('\n'),
    );

    assert.deepEqual(errors, []);
    assert.deepEqual(transactions, [
      {
        bookingDate: '2026-01-02',
        description: 'PAGAMENTO POS ESSELUNGA',
        amount: -54.3,
        type: 'EXPENSE',
      },
      {
        bookingDate: '2026-01-05',
        description: 'ACCREDITO STIPENDIO',
        amount: 2450,
        type: 'INCOME',
      },
    ]);
  });

  it('riconosce i campi anche con intestazioni che non conosce', () => {
    const { transactions, binding } = read(
      [
        'Feld A;Feld B;Feld C',
        '02/01/2026;EDEKA SUPERMARKT;-54,30',
        '05/01/2026;LOHN JANUAR;2.450,00',
      ].join('\n'),
    );

    assert.deepEqual(describeBinding(binding), {
      bookingDate: 'Feld A',
      description: 'Feld B',
      amount: 'Feld C',
      typeHint: null,
    });
    assert.deepEqual(
      transactions.map((t) => [t.bookingDate, t.description, t.amount]),
      [
        ['2026-01-02', 'EDEKA SUPERMARKT', -54.3],
        ['2026-01-05', 'LOHN JANUAR', 2450],
      ],
    );
  });

  it('legge le colonne in qualsiasi ordine', () => {
    assert.deepEqual(
      columnsOf(
        [
          'Importo;Causale;Data operazione',
          '-54,30;SPESA SUPERMERCATO;02/01/2026',
          '-12,00;EDICOLA CENTRALE;03/01/2026',
        ].join('\n'),
      ),
      {
        bookingDate: 'Data operazione',
        description: 'Causale',
        amount: 'Importo',
        typeHint: null,
      },
    );
  });

  it('ignora le colonne che non corrispondono a nessun campo', () => {
    const { transactions, binding } = read(
      [
        'Data contabile;Valuta;Descrizione;Importo;Divisa;IBAN controparte',
        '02/01/2026;03/01/2026;SPESA SUPERMERCATO;-54,30;EUR;IT60X0542811101000000123456',
        '05/01/2026;05/01/2026;STIPENDIO GENNAIO;2.450,00;EUR;IT60X0542811101000000654321',
      ].join('\n'),
    );

    assert.equal(describeBinding(binding).amount, 'Importo');
    assert.equal(describeBinding(binding).description, 'Descrizione');
    assert.deepEqual(
      transactions.map((t) => t.amount),
      [-54.3, 2450],
    );
  });

  it('preferisce la data contabile a quella valuta', () => {
    assert.equal(
      columnsOf(
        [
          'Data valuta;Data contabile;Descrizione;Importo',
          '03/01/2026;02/01/2026;SPESA SUPERMERCATO;-54,30',
          '06/01/2026;05/01/2026;STIPENDIO GENNAIO;2.450,00',
        ].join('\n'),
      ).bookingDate,
      'Data contabile',
    );
  });

  it('distingue l\'importo dal saldo progressivo', () => {
    assert.equal(
      columnsOf(
        [
          'Data;Descrizione;Importo movimento;Saldo dopo movimento',
          '02/01/2026;SPESA SUPERMERCATO;-50,00;950,00',
          '03/01/2026;EDICOLA CENTRALE;-10,00;940,00',
          '05/01/2026;STIPENDIO GENNAIO;100,00;1.040,00',
        ].join('\n'),
      ).amount,
      'Importo movimento',
    );
  });

  it('non confonde una numerazione progressiva con l\'importo', () => {
    assert.equal(
      columnsOf(
        [
          'N;Data;Descrizione;Importo',
          '1;02/01/2026;SPESA SUPERMERCATO;-54,30',
          '2;03/01/2026;EDICOLA CENTRALE;-2,00',
          '3;05/01/2026;STIPENDIO GENNAIO;2.450,00',
        ].join('\n'),
      ).amount,
      'Importo',
    );
  });

  it('usa la dicitura della banca per il tipo di movimento', () => {
    const { transactions } = read(
      [
        'Data;Tipo operazione;Descrizione;Importo',
        '02/01/2026;PRELIEVO;PRELIEVO ATM VIA ROMA;-100,00',
        '03/01/2026;PAGAMENTO;SPESA SUPERMERCATO CENTRO;-54,30',
        '05/01/2026;ACCREDITO;STIPENDIO MENSILE GENNAIO;2.450,00',
        '06/01/2026;PAGAMENTO;FARMACIA COMUNALE DUE;-23,40',
      ].join('\n'),
    );

    assert.deepEqual(
      transactions.map((t) => [t.description, t.type]),
      [
        ['PRELIEVO ATM VIA ROMA', 'WITHDRAWAL'],
        ['SPESA SUPERMERCATO CENTRO', 'EXPENSE'],
        ['STIPENDIO MENSILE GENNAIO', 'INCOME'],
        ['FARMACIA COMUNALE DUE', 'EXPENSE'],
      ],
    );
  });

  it('legge le intestazioni in inglese', () => {
    assert.deepEqual(
      columnsOf(
        [
          'Date,Description,Amount',
          '2026-01-02,GROCERY STORE,-54.30',
          '2026-01-05,SALARY JANUARY,2450.00',
        ].join('\n'),
      ),
      { bookingDate: 'Date', description: 'Description', amount: 'Amount', typeHint: null },
    );
  });

  it('lascia vuoto il campo che non riconosce, senza sollevare errori', () => {
    // Un rilevamento incompleto è il caso della modalità manuale, non un guasto.
    const { headers, rows } = parseCsv(
      ['Descrizione;Note', 'SPESA SUPERMERCATO;prima', 'EDICOLA;seconda'].join('\n'),
    );

    const detected = detectColumns(headers, rows);

    assert.deepEqual(detected.bookingDate, []);
    assert.equal(detected.amount, null);
    assert.ok(detected.description.length > 0, 'la descrizione resta riconosciuta');
  });

  it('importando in automatico rifiuta il file e rimanda alla scelta manuale', () => {
    assert.throws(
      () => read(['Descrizione;Note', 'SPESA SUPERMERCATO;prima', 'EDICOLA;seconda'].join('\n')),
      (error: unknown) => {
        assert.ok(error instanceof ValidationError);
        assert.match(error.message, /data/);
        assert.match(error.message, /importo/);
        assert.match(error.message, /manualmente/);
        return true;
      },
    );
  });
});

describe('colonne dare e avere separate', () => {
  const csv = [
    'Data;Descrizione;Uscite;Entrate',
    '02/01/2026;SPESA SUPERMERCATO;54,30;',
    '03/01/2026;EDICOLA CENTRALE;2,00;',
    '05/01/2026;STIPENDIO GENNAIO;;2.450,00',
  ].join('\n');

  it('riconosce la coppia e le assegna il segno giusto', () => {
    const { transactions, binding, errors } = read(csv);

    assert.deepEqual(errors, []);
    assert.equal(describeBinding(binding).amount, 'Uscite / Entrate');
    assert.deepEqual(
      transactions.map((t) => [t.amount, t.type]),
      [
        [-54.3, 'EXPENSE'],
        [-2, 'EXPENSE'],
        [2450, 'INCOME'],
      ],
    );
  });

  it('riconosce la direzione anche con intestazioni contabili', () => {
    const { transactions } = read(
      [
        'Data;Causale;Avere;Dare',
        '02/01/2026;SPESA SUPERMERCATO;;54,30',
        '05/01/2026;STIPENDIO GENNAIO;2.450,00;',
      ].join('\n'),
    );

    assert.deepEqual(
      transactions.map((t) => t.amount),
      [-54.3, 2450],
    );
  });
});
