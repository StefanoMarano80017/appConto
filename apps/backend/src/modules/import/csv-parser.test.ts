import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from '../../shared/errors.js';
import { parseCsv } from './csv-parser.js';

const rifiutaCon = (content: string, riga: string) =>
  assert.throws(
    () => parseCsv(content),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.match(error.message, new RegExp(`virgolette non chiuse alla riga ${riga}\\.$`));

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

  it('indica la riga giusta anche dopo un campo tra virgolette su più righe', () => {
    // Il campo valido occupa le righe 2-3: le virgolette rimaste aperte sono alla riga 5.
    rifiutaCon('a,b\n1,"prima\nseconda"\n3,4\n5,"x\n6,7\n', '5');
  });

  it('accetta le virgolette interne non raddoppiate, che Papa legge correttamente', () => {
    const csv = 'Data;Descrizione;Importo\n02/01/2026;"BAR "SPORT" ROMA";-3,50\n03/01/2026;"PANE";-1,20\n';
    let parsed: ReturnType<typeof parseCsv> | undefined;
    assert.doesNotThrow(() => {
      parsed = parseCsv(csv);
    });
    assert.deepEqual(
      parsed?.rows.map((row) => [row.Descrizione, row.Importo]),
      [
        ['BAR "SPORT" ROMA', '-3,50'],
        ['PANE', '-1,20'],
      ],
    );
  });

  it('rifiuta la riga fusa da una virgoletta non chiusa con virgolette interne in numero pari', () => {
    // Papa segnala solo `InvalidQuotes` e fonde due righe in una: la riga intermedia andrebbe persa.
    rifiutaCon('Data;Descrizione;Importo\n02/01/2026;"BAR "SPORT" ROMA;-3,50\n03/01/2026;"PANE";-1,20\n', '2');
  });

  it('indica la stessa riga della fusione con fine riga Windows', () => {
    rifiutaCon('Data;Descrizione;Importo\r\n02/01/2026;"BAR "SPORT" ROMA;-3,50\r\n03/01/2026;"PANE";-1,20\r\n', '2');
  });

  it('indica la riga in cui inizia la fusione dopo BOM, righe vuote e un campo su più righe', () => {
    // Il campo valido occupa le righe 3-4 e c'è una riga vuota: la riga fusa inizia alla riga 6.
    rifiutaCon('﻿a;b\n\n1;"prima\nseconda"\n\n2;"BAR "SPORT" ROMA;5\n3;"y";6\n', '6');
  });

  it('accetta un campo su più righe chiuso correttamente', () => {
    const { rows } = parseCsv('a,b\n1,"BAR\nSPORT"\n2,x\n');

    assert.deepEqual(
      rows.map((row) => [row.a, row.b]),
      [
        ['1', 'BAR\nSPORT'],
        ['2', 'x'],
      ],
    );
  });

  it('accetta le virgolette interne in una riga anche se un\'altra ha un campo su più righe', () => {
    // La regola guarda la riga segnalata, non l'intero file.
    const { rows } = parseCsv('a;b\n1;"prima\nseconda"\n2;"BAR "SPORT" ROMA"\n3;y\n');

    assert.deepEqual(
      rows.map((row) => [row.a, row.b]),
      [
        ['1', 'prima\nseconda'],
        ['2', 'BAR "SPORT" ROMA'],
        ['3', 'y'],
      ],
    );
  });

  it('rifiuta anche un campo su più righe con virgolette interne non raddoppiate, indistinguibile dalla fusione', () => {
    // Papa lo leggerebbe correttamente, ma non si distingue dalla riga fusa: limite accettato.
    rifiutaCon('a;b\n1;"BAR\n"SPORT" ROMA"\n2;y\n', '2');
  });
});

describe('righe con un numero di campi diverso dall\'intestazione', () => {
  it('accetta il punto e virgola finale solo su alcune righe di dati', () => {
    const { headers, rows } = parseCsv('a;b\n1;2\n3;4;');

    assert.deepEqual(headers, ['a', 'b']);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.a, '1');
    assert.equal(rows[1]?.a, '3');
  });

  it('accetta il punto e virgola finale su ogni riga di dati ma non sull\'intestazione', () => {
    const { headers, rows } = parseCsv('a;b\n1;2;\n3;4;');

    assert.deepEqual(headers, ['a', 'b']);
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.b, '4');
  });

  it('accetta un\'intestazione con una colonna vuota in più', () => {
    const { headers, rows } = parseCsv('a;b;\n1;2\n3;4');

    assert.deepEqual(headers, ['a', 'b']);
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.b, '4');
  });

  it('accetta una riga finale con meno campi, come "Saldo finale"', () => {
    const { headers, rows } = parseCsv('Data,Importo\n02/01/2026,10.00\nSaldo finale\n');

    assert.deepEqual(headers, ['Data', 'Importo']);
    assert.equal(rows.length, 2);
    assert.equal(rows[1]?.Data, 'Saldo finale');
  });
});
