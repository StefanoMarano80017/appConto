import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import { after, describe, it } from 'node:test';
import {
  CONTROL_PROTOCOL,
  ask,
  isLiveInstance,
  startControlServer,
  type ControlChannel,
} from './control.js';

/**
 * Il canale di controllo.
 *
 * Nessun database, nessun processo figlio: il canale è un socket e delle
 * risposte, e va provato per quello che è — compreso ciò che deve **rifiutare**,
 * perché ascolta su loopback e qualunque programma locale può parlargli.
 */

const aperti: ControlChannel[] = [];

interface Istanza {
  readonly canale: ControlChannel;
  readonly arresti: string[];
  serverPort: number | null;
  token: string;
}

async function istanza(dataRoot = 'C:\\dati\\prova'): Promise<Istanza> {
  const stato: { serverPort: number | null; token: string } = { serverPort: null, token: 'segreto' };
  const arresti: string[] = [];

  const canale = await startControlServer({
    dataRoot,
    token: () => stato.token,
    serverPort: () => stato.serverPort,
    shutdown: () => {
      arresti.push('richiesto');
    },
  });
  aperti.push(canale);

  return {
    canale,
    arresti,
    get serverPort() {
      return stato.serverPort;
    },
    set serverPort(porta: number | null) {
      stato.serverPort = porta;
    },
    get token() {
      return stato.token;
    },
    set token(valore: string) {
      stato.token = valore;
    },
  };
}

/** Manda dei byte grezzi e restituisce la risposta, per provare le forme sbagliate. */
function grezzo(port: number, payload: string): Promise<string> {
  return new Promise((resolve) => {
    let risposta = '';
    const socket = new Socket();
    socket.setEncoding('utf8');
    socket.setTimeout(3_000, () => {
      socket.destroy();
      resolve(risposta);
    });
    socket.on('data', (blocco: string) => {
      risposta += blocco;
    });
    socket.on('close', () => {
      resolve(risposta);
    });
    socket.on('error', () => {
      resolve(risposta);
    });
    socket.connect(port, '127.0.0.1', () => {
      socket.write(payload);
    });
  });
}

const attendi = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('canale di controllo', () => {
  it('risponde a ping dichiarando protocollo, radice dati e porta', async () => {
    const uno = await istanza('C:\\archivio\\uno');
    uno.serverPort = 4711;

    const risposta = await ask(uno.canale.port, { cmd: 'ping' });

    assert.ok(risposta !== null);
    assert.equal(risposta.ok, true);
    assert.ok('protocol' in risposta);
    assert.equal(risposta.protocol, CONTROL_PROTOCOL);
    assert.equal(risposta.dataRoot, 'C:\\archivio\\uno');
    assert.equal(risposta.serverPort, 4711);
    assert.equal(risposta.pid, process.pid);
  });

  it('dichiara serverPort null mentre il server sta ancora partendo', async () => {
    const uno = await istanza();

    const risposta = await ask(uno.canale.port, { cmd: 'ping' });

    assert.ok(risposta !== null && 'serverPort' in risposta);
    assert.equal(risposta.serverPort, null);
  });

  it('accetta l-arresto con il token giusto', async () => {
    const uno = await istanza();

    const risposta = await ask(uno.canale.port, { cmd: 'shutdown', token: 'segreto' });

    assert.deepEqual(risposta, { ok: true, accepted: 'shutdown' });
    // La risposta parte prima dell'arresto: chi l'ha chiesto deve sapere che è
    // stata accettata.
    await attendi(50);
    assert.deepEqual(uno.arresti, ['richiesto']);
  });

  it('rifiuta l-arresto senza il token e non ferma niente', async () => {
    const uno = await istanza();

    for (const richiesta of [
      { cmd: 'shutdown' as const, token: '' },
      { cmd: 'shutdown' as const, token: 'sbagliato' },
    ]) {
      const risposta = await ask(uno.canale.port, richiesta);
      assert.ok(risposta !== null);
      assert.equal(risposta.ok, false);
    }

    await attendi(50);
    assert.deepEqual(uno.arresti, [], 'nessun arresto deve essere avvenuto');
  });

  it('rifiuta l-arresto finché non esiste un token', async () => {
    const uno = await istanza();
    // È lo stato fra l'apertura del canale e l'acquisizione del lock: il
    // canale risponde, ma non c'è ancora un'istanza da fermare.
    uno.token = '';

    const risposta = await ask(uno.canale.port, { cmd: 'shutdown', token: '' });

    assert.ok(risposta !== null);
    assert.equal(risposta.ok, false);
    await attendi(50);
    assert.deepEqual(uno.arresti, []);
  });

  it('rifiuta un comando sconosciuto e una richiesta non interpretabile', async () => {
    const uno = await istanza();

    const sconosciuto = JSON.parse(await grezzo(uno.canale.port, '{"cmd":"formatta"}\n')) as {
      ok: boolean;
      problem: string;
    };
    assert.equal(sconosciuto.ok, false);
    assert.match(sconosciuto.problem, /sconosciuto/);

    const spazzatura = JSON.parse(await grezzo(uno.canale.port, 'non sono json\n')) as {
      ok: boolean;
    };
    assert.equal(spazzatura.ok, false);
  });

  it('chiude una richiesta troppo grande senza rispondere', async () => {
    const uno = await istanza();

    // Nessuna riga, solo byte: un programma locale non deve poter far crescere
    // la memoria del launcher tenendo un socket aperto.
    const risposta = await grezzo(uno.canale.port, 'x'.repeat(9 * 1024));

    assert.equal(risposta, '');
  });
});

describe('riconoscere un-istanza viva', () => {
  it('riconosce sé stessa sulla propria radice dati', async () => {
    const uno = await istanza('C:\\archivio\\uno');

    assert.equal(await isLiveInstance(uno.canale.port, 'C:\\archivio\\uno'), true);
  });

  it('non riconosce un-istanza che dichiara un-altra radice dati', async () => {
    const uno = await istanza('C:\\archivio\\uno');

    // È il caso della porta riciclata: qualcosa risponde, ma non è il
    // custode di questo archivio.
    assert.equal(await isLiveInstance(uno.canale.port, 'C:\\archivio\\due'), false);
  });

  it('non riconosce una porta chiusa', async () => {
    const uno = await istanza();
    const porta = uno.canale.port;
    await uno.canale.close();

    assert.equal(await isLiveInstance(porta, 'C:\\dati\\prova'), false);
  });

  it('non riconosce qualcosa che risponde ma non parla questo protocollo', async () => {
    const { createServer } = await import('node:net');
    const estraneo = createServer((socket) => {
      socket.end('HTTP/1.1 200 OK\r\n\r\n');
    });
    await new Promise<void>((resolve) => {
      estraneo.listen(0, '127.0.0.1', resolve);
    });
    const porta = (estraneo.address() as { port: number }).port;

    try {
      assert.equal(await isLiveInstance(porta, 'C:\\dati\\prova'), false);
    } finally {
      estraneo.close();
    }
  });
});

after(async () => {
  for (const canale of aperti) {
    await canale.close();
  }
});
