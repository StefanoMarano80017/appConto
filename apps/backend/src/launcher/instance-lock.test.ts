import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { CONTROL_PROTOCOL, startControlServer, type ControlChannel } from './control.js';
import { acquireInstanceLock, parseLockContent, readInstanceLock } from './instance-lock.js';

/**
 * Istanza unica per archivio.
 *
 * Ogni caso lavora su una radice dati temporanea: il lock è un file dentro
 * `DATA_ROOT`, quindi un test che usasse la radice reale vi scriverebbe
 * davvero. Nessun database viene aperto — il lock esiste proprio per venire
 * *prima* di quello.
 */

const temporanee: string[] = [];
const canali: ControlChannel[] = [];

function radice(nome: string): string {
  const creata = mkdtempSync(path.join(tmpdir(), `appconto-lock-${nome}-`));
  temporanee.push(creata);

  return creata;
}

const lockDi = (dataRoot: string): string => path.join(dataRoot, 'instance.lock');

/** Un canale di controllo vero, che dichiara una radice dati. */
async function canale(dataRoot: string): Promise<ControlChannel> {
  const aperto = await startControlServer({
    dataRoot,
    token: () => 'irrilevante',
    serverPort: () => null,
    shutdown: () => {
      // Nessun arresto in questi casi: si prova l'esclusione, non il ciclo di
      // vita.
    },
  });
  canali.push(aperto);

  return aperto;
}

interface Presa {
  readonly dataRoot: string;
  readonly lockFile: string;
  readonly canale: ControlChannel;
}

/** Prende il lock come farebbe il launcher: canale in ascolto, poi file. */
async function prendi(dataRoot: string): Promise<Presa & { release: () => void }> {
  const aperto = await canale(dataRoot);
  const esito = await acquireInstanceLock({
    lockFile: lockDi(dataRoot),
    dataRoot,
    appRoot: 'C:\\app',
    controlPort: aperto.port,
    now: () => new Date('2026-09-02T10:00:00.000Z'),
  });

  assert.equal(esito.acquired, true, 'il primo lock deve riuscire');
  if (!esito.acquired) {
    throw new Error('non raggiungibile');
  }

  return {
    dataRoot,
    lockFile: lockDi(dataRoot),
    canale: aperto,
    release: esito.lock.release,
  };
}

describe('§19 caso A — due istanze sulla stessa radice dati', () => {
  it('la seconda viene rifiutata e riceve chi è il proprietario', async () => {
    const dati = radice('a');
    const primo = await prendi(dati);

    const secondoCanale = await canale(dati);
    const secondo = await acquireInstanceLock({
      lockFile: lockDi(dati),
      dataRoot: dati,
      appRoot: 'C:\\altra-copia-del-package',
      controlPort: secondoCanale.port,
      now: () => new Date(),
    });

    assert.equal(secondo.acquired, false);
    if (secondo.acquired) {
      return;
    }

    assert.equal(secondo.running.controlPort, primo.canale.port);
    assert.equal(secondo.running.dataRoot, dati);
    assert.equal(secondo.running.pid, process.pid);
    // Il file non è stato riscritto dal secondo: il proprietario è ancora il
    // primo, con il suo token.
    const suDisco = readInstanceLock(primo.lockFile);
    assert.equal(suDisco?.controlPort, primo.canale.port);
  });
});

describe('§19 caso B — due istanze su radici diverse', () => {
  it('entrambe vengono ammesse', async () => {
    const uno = radice('b1');
    const due = radice('b2');

    const primo = await prendi(uno);
    const secondo = await prendi(due);

    assert.ok(existsSync(primo.lockFile));
    assert.ok(existsSync(secondo.lockFile));
    assert.notEqual(primo.lockFile, secondo.lockFile);
    // Nessuna chiave calcolata: il lock è *dentro* la radice dati, quindi due
    // radici diverse sono due file diversi per costruzione.
    assert.equal(readInstanceLock(primo.lockFile)?.dataRoot, uno);
    assert.equal(readInstanceLock(secondo.lockFile)?.dataRoot, due);
  });
});

describe('§19 caso C — rilascio e riavvio', () => {
  it('dopo il rilascio la stessa radice è di nuovo disponibile', async () => {
    const dati = radice('c');
    const primo = await prendi(dati);

    primo.release();
    assert.equal(existsSync(primo.lockFile), false, 'il rilascio deve rimuovere il file');
    await primo.canale.close();

    const secondo = await prendi(dati);
    assert.ok(existsSync(secondo.lockFile));
  });

  it('il rilascio è idempotente e non toglie il lock a un altro', async () => {
    const dati = radice('c2');
    const primo = await prendi(dati);

    primo.release();
    primo.release();
    await primo.canale.close();

    // Un altro prende il lock; il rilascio del primo non deve toccarlo.
    const secondo = await prendi(dati);
    const tokenDelSecondo = readInstanceLock(secondo.lockFile)?.token;

    primo.release();

    assert.equal(readInstanceLock(secondo.lockFile)?.token, tokenDelSecondo);
    assert.ok(existsSync(secondo.lockFile));
  });
});

describe('§19 caso D — dopo una terminazione anomala', () => {
  it('un lock il cui proprietario non risponde viene preso', async () => {
    const dati = radice('d');

    /*
     * Il residuo di un processo terminato di forza: il file c'è, con una porta
     * su cui non c'è più nessuno. È esattamente ciò che resta dopo un
     * `taskkill /F`, e ciò che rende inservibili i lock basati sulla sola
     * esistenza di un file.
     */
    const mortoCanale = await canale(dati);
    const portaMorta = mortoCanale.port;
    await mortoCanale.close();

    writeFileSync(
      lockDi(dati),
      JSON.stringify({
        protocol: CONTROL_PROTOCOL,
        pid: 999_999,
        startedAt: '2026-09-01T10:00:00.000Z',
        appRoot: 'C:\\app',
        dataRoot: dati,
        controlPort: portaMorta,
        token: 'token-del-processo-morto',
        serverPort: 4711,
      }),
      'utf8',
    );

    const nuovoCanale = await canale(dati);
    const esito = await acquireInstanceLock({
      lockFile: lockDi(dati),
      dataRoot: dati,
      appRoot: 'C:\\app',
      controlPort: nuovoCanale.port,
      now: () => new Date(),
    });

    assert.equal(esito.acquired, true, 'un lock abbandonato non deve bloccare l-avvio');
    assert.equal(readInstanceLock(lockDi(dati))?.controlPort, nuovoCanale.port);
    assert.notEqual(readInstanceLock(lockDi(dati))?.token, 'token-del-processo-morto');
  });

  it('un pid vivo non basta a tenere il lock', async () => {
    const dati = radice('d2');

    // Il pid è quello di *questo* processo — vivissimo — ma la porta di
    // controllo non risponde. È il caso del numero di processo riciclato: se
    // il pid decidesse, l'applicazione resterebbe bloccata per sempre.
    const mortoCanale = await canale(dati);
    const portaMorta = mortoCanale.port;
    await mortoCanale.close();

    writeFileSync(
      lockDi(dati),
      JSON.stringify({
        protocol: CONTROL_PROTOCOL,
        pid: process.pid,
        startedAt: '2026-09-01T10:00:00.000Z',
        appRoot: 'C:\\app',
        dataRoot: dati,
        controlPort: portaMorta,
        token: 'vecchio',
        serverPort: null,
      }),
      'utf8',
    );

    const nuovoCanale = await canale(dati);
    const esito = await acquireInstanceLock({
      lockFile: lockDi(dati),
      dataRoot: dati,
      appRoot: 'C:\\app',
      controlPort: nuovoCanale.port,
      now: () => new Date(),
    });

    assert.equal(esito.acquired, true);
  });

  it('un lock illeggibile viene sostituito, non rispettato', async () => {
    const dati = radice('d3');
    writeFileSync(lockDi(dati), 'questo non è JSON', 'utf8');

    const nuovoCanale = await canale(dati);
    const esito = await acquireInstanceLock({
      lockFile: lockDi(dati),
      dataRoot: dati,
      appRoot: 'C:\\app',
      controlPort: nuovoCanale.port,
      now: () => new Date(),
      // Il tempo di grazia per una scrittura a metà non serve attenderlo
      // davvero: qui è spazzatura, non un file in corso di scrittura.
      wait: () => Promise.resolve(),
    });

    assert.equal(esito.acquired, true, 'un file di spazzatura non deve bloccare l-applicazione');
    assert.equal(readLock(lockDi(dati)).controlPort, nuovoCanale.port);
  });

  it("un lock che nomina un'altra radice dati viene considerato abbandonato", async () => {
    const dati = radice('d4');
    const altra = radice('d5');

    // Il canale risponde, ma dichiara un altro archivio: il lock non descrive
    // il custode di *questa* cartella.
    const altroCanale = await canale(altra);

    writeFileSync(
      lockDi(dati),
      JSON.stringify({
        protocol: CONTROL_PROTOCOL,
        pid: process.pid,
        startedAt: '2026-09-01T10:00:00.000Z',
        appRoot: 'C:\\app',
        dataRoot: dati,
        controlPort: altroCanale.port,
        token: 'vecchio',
        serverPort: null,
      }),
      'utf8',
    );

    const nuovoCanale = await canale(dati);
    const esito = await acquireInstanceLock({
      lockFile: lockDi(dati),
      dataRoot: dati,
      appRoot: 'C:\\app',
      controlPort: nuovoCanale.port,
      now: () => new Date(),
    });

    assert.equal(esito.acquired, true);
  });
});

describe('la porta del server registrata nel lock', () => {
  it('viene scritta e resta leggibile da un secondo avvio', async () => {
    const dati = radice('porta');
    const aperto = await canale(dati);
    const esito = await acquireInstanceLock({
      lockFile: lockDi(dati),
      dataRoot: dati,
      appRoot: 'C:\\app',
      controlPort: aperto.port,
      now: () => new Date(),
    });

    assert.equal(esito.acquired, true);
    if (!esito.acquired) {
      return;
    }

    assert.equal(readLock(lockDi(dati)).serverPort, null);

    esito.lock.recordServerPort(47318);

    const dopo = readLock(lockDi(dati));
    assert.equal(dopo.serverPort, 47318);
    // Il token non cambia: chi lo ha in mano può ancora fermare l'istanza.
    assert.equal(dopo.token, esito.lock.content.token);
  });
});

describe('interpretazione del contenuto', () => {
  it('accetta un lock completo', () => {
    const contenuto = parseLockContent(
      JSON.stringify({
        protocol: CONTROL_PROTOCOL,
        pid: 42,
        startedAt: '2026-09-02T10:00:00.000Z',
        appRoot: 'C:\\app',
        dataRoot: 'C:\\dati',
        controlPort: 5000,
        token: 'abc',
        serverPort: 3000,
      }),
    );

    assert.deepEqual(contenuto, {
      protocol: CONTROL_PROTOCOL,
      pid: 42,
      startedAt: '2026-09-02T10:00:00.000Z',
      appRoot: 'C:\\app',
      dataRoot: 'C:\\dati',
      controlPort: 5000,
      token: 'abc',
      serverPort: 3000,
    });
  });

  it('rifiuta le forme che non permettono di riconoscere il proprietario', () => {
    const base = {
      protocol: CONTROL_PROTOCOL,
      pid: 42,
      startedAt: '2026-09-02T10:00:00.000Z',
      appRoot: 'C:\\app',
      dataRoot: 'C:\\dati',
      controlPort: 5000,
      token: 'abc',
      serverPort: null,
    };

    const forme: [string, unknown][] = [
      ['non JSON', undefined],
      ['un array', []],
      ['un numero', 7],
      ['senza protocollo', { ...base, protocol: undefined }],
      ['con un altro protocollo', { ...base, protocol: 'qualcosaltro/9' }],
      ['senza porta di controllo', { ...base, controlPort: undefined }],
      ['con porta zero', { ...base, controlPort: 0 }],
      ['con porta non intera', { ...base, controlPort: 1.5 }],
      ['senza token', { ...base, token: '' }],
      ['senza radice dati', { ...base, dataRoot: '' }],
      ['senza pid', { ...base, pid: undefined }],
    ];

    for (const [descrizione, forma] of forme) {
      const testo = forma === undefined ? 'non JSON' : JSON.stringify(forma);
      assert.equal(parseLockContent(testo), null, `doveva rifiutare: ${descrizione}`);
    }
  });

  it('tollera i campi solo descrittivi', () => {
    const contenuto = parseLockContent(
      JSON.stringify({
        protocol: CONTROL_PROTOCOL,
        pid: 42,
        dataRoot: 'C:\\dati',
        controlPort: 5000,
        token: 'abc',
      }),
    );

    // `startedAt` e `appRoot` servono a chi legge il file, non a decidere:
    // la loro assenza non rende il lock inservibile.
    assert.equal(contenuto?.startedAt, 'sconosciuto');
    assert.equal(contenuto?.appRoot, 'sconosciuto');
    assert.equal(contenuto?.serverPort, null);
  });

  it('un file che non esiste non è un lock', () => {
    assert.equal(readInstanceLock(path.join(radice('vuota'), 'instance.lock')), null);
  });
});

/** Il lock su disco, preteso valido. */
function readLock(file: string): NonNullable<ReturnType<typeof parseLockContent>> {
  const contenuto = parseLockContent(readFileSync(file, 'utf8'));
  assert.ok(contenuto !== null, `il lock ${file} doveva essere leggibile`);

  return contenuto;
}

after(async () => {
  for (const aperto of canali) {
    await aperto.close();
  }
  for (const cartella of temporanee) {
    rmSync(cartella, { recursive: true, force: true });
  }
});
