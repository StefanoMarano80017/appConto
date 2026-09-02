import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import Database from 'better-sqlite3';

/**
 * Atomicità dell'import.
 *
 * La proprietà da dimostrare non è che l'import funzioni — quello lo provano
 * gli altri test — ma che un guasto **a metà** non lasci un archivio riempito
 * a metà. È il caso peggiore possibile su dati contabili, perché non produce
 * nessun errore visibile: 2.500 righe su 5.000 sembrano un estratto conto, e
 * chi le guarda un mese dopo non ha modo di sapere che mancano le altre.
 *
 * Il guasto si provoca sostituendo temporaneamente l'inserimento nel
 * repository con uno che scrive il primo blocco e poi solleva. Non serve
 * nessun appiglio nel codice di produzione, e il punto di rottura è
 * esattamente quello che conta: dentro l'operazione, dopo che qualcosa è già
 * stato scritto.
 *
 * ## Isolamento
 *
 * Radice dati temporanea, scelta prima di importare i moduli che aprono la
 * connessione. Nessuna riga di questo file raggiunge l'archivio reale.
 */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-atomic-'));
const databaseFile = path.join(dataRoot, 'database.sqlite');
process.env.DATABASE_FILE = databaseFile;

const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { config } = await import('../../config.js');
const { importService } = await import('./import.service.js');
const { transactionsRepository } = await import('../transactions/transactions.repository.js');
const { transactionsService } = await import('../transactions/index.js');
const { merchantsRepository } = await import('../merchants/merchants.repository.js');

runMigrations();

after(() => {
  closeDatabase();
  try {
    rmSync(dataRoot, { recursive: true, force: true });
  } catch {
    // su Windows il file può restare bloccato: è comunque una cartella temporanea
  }
});

/** Un CSV di righe tutte distinte, riconoscibili dal prefisso. */
function csv(righe: number, prefisso: string): string {
  const corpo = Array.from({ length: righe }, (_unused, indice) => {
    const giorno = String((indice % 28) + 1).padStart(2, '0');
    const mese = String((indice % 12) + 1).padStart(2, '0');

    return `${giorno}/${mese}/2026,${prefisso} ${String(indice)},-${String(indice + 1)}.50`;
  });

  return ['Data contabile,Descrizione,Importo', ...corpo].join('\r\n');
}

const conteggi = (): { transazioni: number; merchant: number } => ({
  transazioni: transactionsService.listAll().length,
  merchant: merchantsRepository.findAll().length,
});

/** Esegue `work` con l'inserimento delle transazioni guasto a metà. */
function conGuastoAMeta(work: () => void): void {
  const originale = transactionsRepository.insertMany.bind(transactionsRepository);

  transactionsRepository.insertMany = (items) => {
    // Metà scritta, poi il guasto: è la forma esatta del caso da escludere.
    originale(items.slice(0, Math.floor(items.length / 2)));

    throw new Error('guasto simulato a metà inserimento');
  };

  try {
    work();
  } finally {
    transactionsRepository.insertMany = originale;
  }
}

describe('isolamento del test', () => {
  it('lavora su un database temporaneo', () => {
    assert.equal(config.databaseFile, databaseFile);
    assert.ok(config.databaseFile.startsWith(tmpdir()));
    assert.ok(!config.databaseFile.includes(`${path.sep}Desktop${path.sep}`));
  });
});

describe('un guasto a metà import non lascia un import a metà', () => {
  it('annulla tutto: né transazioni né esercenti restano indietro', () => {
    const primoImport = importService.importCsv(csv(1_200, 'PRIMO'));
    assert.equal(primoImport.imported, 1_200);

    const prima = conteggi();
    assert.equal(prima.transazioni, 1_200);
    assert.ok(prima.merchant >= 1_200, 'ogni descrizione diversa è un esercente diverso');

    conGuastoAMeta(() => {
      assert.throws(
        () => importService.importCsv(csv(1_200, 'GUASTO')),
        /guasto simulato/,
      );
    });

    const dopo = conteggi();

    assert.equal(dopo.transazioni, prima.transazioni, 'nessuna transazione parziale');
    // Questo è il controllo che dimostra che la transazione racchiude l'intera
    // operazione e non il solo inserimento: gli esercenti nascono *prima*
    // delle transazioni che li citano, quindi senza una transazione unica
    // resterebbero in archivio senza alcun movimento.
    assert.equal(dopo.merchant, prima.merchant, 'nessun esercente orfano');
  });

  it('il database resta apribile e integro dopo il guasto', () => {
    const lettore = new Database(databaseFile, { readonly: true, fileMustExist: true });

    try {
      assert.equal(lettore.pragma('integrity_check', { simple: true }), 'ok');
      assert.equal(
        (lettore.prepare('select count(*) as c from transactions').get() as { c: number }).c,
        1_200,
      );
      assert.equal(
        (lettore.prepare("select count(*) as c from transactions where description like 'GUASTO%'")
          .get() as { c: number }).c,
        0,
        'nessuna riga del CSV fallito è sopravvissuta',
      );
    } finally {
      lettore.close();
    }
  });
});

describe('dopo il guasto, lo stesso CSV si reimporta per intero', () => {
  it('tutte le righe entrano, una volta sola', () => {
    const prima = conteggi();

    const ripetuto = importService.importCsv(csv(1_200, 'GUASTO'));

    assert.equal(ripetuto.rowsRead, 1_200);
    assert.equal(ripetuto.imported, 1_200, 'il rollback ha liberato del tutto lo spazio logico');
    assert.equal(ripetuto.duplicates, 0, 'il tentativo fallito non ha lasciato duplicati');
    assert.equal(ripetuto.failed, 0);

    assert.equal(conteggi().transazioni, prima.transazioni + 1_200);
  });

  it('lo stesso CSV una terza volta non aggiunge niente', () => {
    const prima = conteggi();

    const ancora = importService.importCsv(csv(1_200, 'GUASTO'));

    assert.equal(ancora.imported, 0);
    assert.equal(ancora.duplicates, 1_200, "l'idempotenza del fingerprint è intatta");
    assert.equal(ancora.merchantsCreated, 0);

    assert.deepEqual(conteggi(), prima, 'archivio invariato');
  });

  it("il riconoscimento dei duplicati non è stato sostituito da un secondo meccanismo", () => {
    // Una riga identica a una già presente resta un duplicato; una riga nuova
    // entra. È lo stesso comportamento del fingerprint introdotto prima di
    // questo lavoro: nessun secondo meccanismo si è aggiunto.
    const misto = [
      'Data contabile,Descrizione,Importo',
      '01/01/2026,GUASTO 0,-1.50',
      '15/06/2026,RIGA INEDITA,-77.00',
    ].join('\r\n');

    const esito = importService.importCsv(misto);

    assert.equal(esito.imported, 1);
    assert.equal(esito.duplicates, 1);
  });
});

describe("un'operazione riuscita resta scritta", () => {
  it('la transazione conferma, non si limita a non annullare', () => {
    const prima = conteggi();
    const esito = importService.importCsv(csv(40, 'CONFERMATO'));

    assert.equal(esito.imported, 40);

    const lettore = new Database(databaseFile, { readonly: true, fileMustExist: true });
    try {
      assert.equal(
        (lettore
          .prepare("select count(*) as c from transactions where description like 'CONFERMATO%'")
          .get() as { c: number }).c,
        40,
        'le righe sono visibili anche da una connessione diversa',
      );
    } finally {
      lettore.close();
    }

    assert.equal(conteggi().transazioni, prima.transazioni + 40);
  });
});
