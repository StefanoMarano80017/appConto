import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from '../../shared/errors.js';
import { parseCsv } from './csv-parser.js';

const rifiutaCon = (content: string, riga: string) =>
  assert.throws(
    () => parseCsv(content),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.match(error.message, new RegExp(`\\b${riga}\\b`));

      return true;
    },
  );

describe('lettura del CSV', () => {
  it('rimuove il BOM iniziale dalla prima intestazione', () => {
    const { headers } = parseCsv('﻿Data contabile,Importo\n02/01/2026,10.00\n');

    assert.equal(headers[0], 'Data contabile');
  });

  it('rifiuta un contenuto vuoto o di soli spazi', () => {
    assert.throws(() => parseCsv(''), ValidationError);
    assert.throws(() => parseCsv('   \n  \n'), ValidationError);
  });

  it('legge le stesse righe con punto e virgola e con virgola', () => {
    const conVirgola = parseCsv('Data,Descrizione,Importo\n02/01/2026,POS,-5.00\n03/01/2026,STIPENDIO,100.00\n');
    const conPuntoEVirgola = parseCsv('Data;Descrizione;Importo\n02/01/2026;POS;-5.00\n03/01/2026;STIPENDIO;100.00\n');

    assert.deepEqual(conPuntoEVirgola, conVirgola);
    assert.equal(conVirgola.rows.length, 2);
  });

  it('ignora le righe vuote intermedie e finali', () => {
    const { rows } = parseCsv('a,b\n1,2\n\n3,4\n\n\n');

    assert.equal(rows.length, 2);
  });

  it('accetta una sola colonna senza lamentare il delimitatore', () => {
    const { headers, rows } = parseCsv('Importo\n1\n2\n');

    assert.deepEqual(headers, ['Importo']);
    assert.equal(rows.length, 2);
  });
});

describe('CSV malformato', () => {
  it('rifiuta il file con virgolette non chiuse indicando la riga del file', () => {
    rifiutaCon('Data,Importo\n02/01/2026,10.00\n03/01/2026,"5.00\n04/01/2026,7.00\n', '3');
  });

  it('indica la riga del file anche con punto e virgola e fine riga Windows', () => {
    rifiutaCon('Data;Importo\r\n02/01/2026;1\r\n03/01/2026;2\r\n04/01/2026;"3\r\n05/01/2026;4\r\n', '4');
  });

  it('conta la riga dopo il BOM e dopo le righe vuote', () => {
    rifiutaCon('﻿a,b\n1,2\n\n3,"x\n4,5\n', '4');
  });

  it('rifiuta il file con un numero di campi diverso dall\'intestazione', () => {
    rifiutaCon('a,b\n1,2\n3,4,5\n', '3');
    rifiutaCon('a,b\n1,2\n3\n', '3');
  });
});
