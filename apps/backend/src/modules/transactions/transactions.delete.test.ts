import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

/**
 * Eliminare i movimenti.
 *
 * ## Isolamento
 *
 * Radice dati temporanea scelta **prima** degli import: `db/client.js` apre la
 * connessione nel momento in cui viene valutato, quindi la scelta va fatta
 * prima o si aprirebbe l'archivio reale.
 */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-del-'));
process.env.DATABASE_FILE = path.join(dataRoot, 'database.sqlite');

const { config } = await import('../../config.js');
const { runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { transactionsService } = await import('./transactions.service.js');
const { transactionsRepository } = await import('./transactions.repository.js');
const { merchantsService } = await import('../merchants/index.js');
const { ConflictError, ValidationError } = await import('../../shared/errors.js');
const { loansService } = await import('../loans/index.js');

runMigrations();

after(() => {
  try {
    rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque temporaneo
  }
});

/** Nessuno usa questi movimenti: è il caso normale. */
const nessunLegame = { usagesOf: () => [] };

/** Importa delle righe e restituisce le transazioni create, dalla più recente. */
function importa(righe: readonly string[]): { id: string; description: string }[] {
  importService.importCsv(['Data contabile,Descrizione,Importo', ...righe].join('\r\n'));

  return transactionsService.listAll().map((transaction) => ({
    id: transaction.id,
    description: transaction.description,
  }));
}

/** Svuota l'archivio fra un caso e l'altro, senza passare dal servizio in prova. */
function ripulisci(): void {
  const tutte = transactionsService.listAll().map((transaction) => transaction.id);
  if (tutte.length > 0) {
    transactionsRepository.deleteMany(tutte);
  }
}

describe('isolamento del test', () => {
  it('il processo usa un database temporaneo', () => {
    assert.ok(config.databaseFile.startsWith(tmpdir()));
    assert.equal(path.dirname(config.databaseFile), dataRoot);
  });
});

describe('eliminazione di movimenti', () => {
  it('elimina un movimento e lo dice', () => {
    ripulisci();
    const [prima] = importa(['01/05/2026,MOVIMENTO DA ELIMINARE,-10.00']);
    assert.ok(prima !== undefined);

    const esito = transactionsService.remove([prima.id], nessunLegame);

    assert.deepEqual(esito, { requested: 1, deleted: 1, notFound: [] });
    assert.equal(transactionsService.findById(prima.id), null);
    assert.equal(transactionsService.listAll().length, 0);
  });

  it('elimina una selezione, lasciando fuori ciò che non è stato scelto', () => {
    ripulisci();
    const movimenti = importa([
      '01/05/2026,PRIMO,-10.00',
      '02/05/2026,SECONDO,-20.00',
      '03/05/2026,TERZO,-30.00',
      '04/05/2026,QUARTO,-40.00',
    ]);
    const daEliminare = movimenti
      .filter((m) => m.description === 'PRIMO' || m.description === 'TERZO')
      .map((m) => m.id);

    const esito = transactionsService.remove(daEliminare, nessunLegame);

    assert.equal(esito.deleted, 2);
    assert.deepEqual(
      transactionsService
        .listAll()
        .map((t) => t.description)
        .sort(),
      ['QUARTO', 'SECONDO'],
    );
  });

  it('un identificativo ripetuto conta una volta', () => {
    ripulisci();
    const [uno] = importa(['01/05/2026,UNO SOLO,-10.00']);
    assert.ok(uno !== undefined);

    const esito = transactionsService.remove([uno.id, uno.id, uno.id], nessunLegame);

    assert.deepEqual(esito, { requested: 1, deleted: 1, notFound: [] });
  });

  it('un identificativo che non esiste viene riportato, non fatto fallire', () => {
    ripulisci();
    const [uno] = importa(['01/05/2026,ESISTE,-10.00']);
    assert.ok(uno !== undefined);

    const esito = transactionsService.remove([uno.id, 'non-esisto'], nessunLegame);

    // L'utente lavora su un elenco che ha davanti: ciò che non c'è più è già
    // nello stato che voleva. Ma glielo si dice, perché la schermata era
    // vecchia.
    assert.equal(esito.deleted, 1);
    assert.deepEqual(esito.notFound, ['non-esisto']);
  });

  it('senza identificativi è una richiesta malformata', () => {
    assert.throws(() => transactionsService.remove([], nessunLegame), ValidationError);
  });

  it('i merchant restano, anche senza più movimenti', () => {
    ripulisci();
    const movimenti = importa(['01/05/2026,ESSELUNGA MILANO,-10.00']);
    const merchantPrima = merchantsService.listAllWithCategory().length;
    assert.ok(merchantPrima > 0);

    transactionsService.remove(
      movimenti.map((m) => m.id),
      nessunLegame,
    );

    /*
     * L'anagrafica dei merchant è il lavoro di classificazione dell'utente.
     * Cancellarla in silenzio significherebbe che reimportando lo stesso
     * estratto conto le categorie andrebbero rifatte a mano.
     */
    assert.equal(merchantsService.listAllWithCategory().length, merchantPrima);
  });
});

describe('movimenti usati da qualcos-altro', () => {
  it('rifiuta tutta la selezione, e non elimina niente', () => {
    ripulisci();
    const movimenti = importa([
      '01/05/2026,MOVIMENTO LIBERO,-10.00',
      '02/05/2026,MOVIMENTO IMPEGNATO,-20.00',
    ]);
    const impegnato = movimenti.find((m) => m.description === 'MOVIMENTO IMPEGNATO');
    assert.ok(impegnato !== undefined);

    const legame = {
      usagesOf: () => [{ transactionId: impegnato.id, usedBy: 'prestito a Marco' }],
    };

    assert.throws(
      () =>
        transactionsService.remove(
          movimenti.map((m) => m.id),
          legame,
        ),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        assert.match(error.message, /prestito a Marco/);

        return true;
      },
    );

    /*
     * Tutti o nessuno.
     *
     * Eliminare quelli liberi e rifiutare gli altri lascerebbe l'utente con
     * metà del lavoro fatto senza sapere quale metà, e nulla da annullare.
     */
    assert.equal(transactionsService.listAll().length, 2);
  });

  it('il messaggio distingue un movimento da molti', () => {
    ripulisci();
    const movimenti = importa([
      '01/05/2026,PRIMO IMPEGNATO,-10.00',
      '02/05/2026,SECONDO IMPEGNATO,-20.00',
    ]);

    const dueLegami = {
      usagesOf: () => movimenti.map((m) => ({ transactionId: m.id, usedBy: 'prestito a Lucia' })),
    };

    assert.throws(
      () =>
        transactionsService.remove(
          movimenti.map((m) => m.id),
          dueLegami,
        ),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        assert.match(error.message, /2 movimenti/);

        return true;
      },
    );
  });

  it('il legame viene chiesto una volta sola, con tutti gli identificativi', () => {
    ripulisci();
    const movimenti = importa(['01/05/2026,UNO,-10.00', '02/05/2026,DUE,-20.00']);
    const chiamate: readonly string[][] = [];
    const registra = {
      usagesOf: (ids: readonly string[]) => {
        (chiamate as string[][]).push([...ids]);

        return [];
      },
    };

    transactionsService.remove(
      movimenti.map((m) => m.id),
      registra,
    );

    assert.equal(chiamate.length, 1, 'una richiesta per movimento sarebbe una query per riga');
    assert.equal(chiamate[0]?.length, 2);
  });
});

describe('il vincolo di integrità è la rete sotto la porta', () => {
  it('un movimento con un prestito vero non si elimina nemmeno aggirando il controllo', () => {
    ripulisci();
    importa(['01/06/2026,PRESTITO A GIULIA,-500.00']);
    const movimento = transactionsService.listAll()[0];
    assert.ok(movimento !== undefined);

    // Un prestito vero, creato dal proprio servizio.
    transactionsService.updateType(movimento.id, 'LOAN');
    loansService.create({
      transactionId: movimento.id,
      borrowerName: 'Giulia',
      amount: 500,
      lentAt: '2026-06-01',
    });

    /*
     * Qui la porta dichiara che nessuno usa il movimento — è la bugia che un
     * difetto futuro potrebbe introdurre — e l'eliminazione deve fallire
     * comunque, perché il database non lo permette. La porta serve a dare un
     * messaggio comprensibile, non a essere l'unica difesa.
     */
    assert.throws(() => transactionsService.remove([movimento.id], nessunLegame));

    assert.equal(transactionsService.listAll().length, 1);
  });

  it('e la porta reale lo riconosce, con il nome di chi ha ricevuto il prestito', () => {
    const movimento = transactionsService.listAll()[0];
    assert.ok(movimento !== undefined);

    const usi = loansService.transactionUsages([movimento.id]);

    assert.equal(usi.length, 1);
    assert.equal(usi[0]?.transactionId, movimento.id);
    assert.match(usi[0]?.usedBy ?? '', /prestito a Giulia/);
  });

  it('un movimento senza prestiti non risulta usato', () => {
    assert.deepEqual(loansService.transactionUsages(['qualunque-altro']), []);
  });
});
