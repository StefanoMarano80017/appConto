import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, describe, it } from 'node:test';
import { httpHealthProbe, waitUntilReady, type ReadinessPort } from './readiness.js';

/**
 * §21 — il browser non si apre prima che l'applicazione risponda.
 *
 * La distinzione fra "il processo è partito" e "l'applicazione è pronta" è il
 * punto: fra i due momenti ci sono l'apertura del database, un eventuale
 * ripristino differito, le migrazioni e il backup obbligatorio prima di
 * migrare. Qui il tempo è finto e la salute è una funzione, così ogni
 * combinazione — pronto al terzo tentativo, processo morto durante l'attesa,
 * scadenza — si prova in millisecondi.
 */

const aperti: Server[] = [];

/** Una porta iniettata: nessuna rete, nessun processo, tempo simulato. */
function porta(overrides: Partial<ReadinessPort> = {}): ReadinessPort & { tentativi: string[] } {
  const tentativi: string[] = [];
  let adesso = 0;

  return {
    tentativi,
    probe: () => {
      tentativi.push('probe');

      return Promise.resolve(false);
    },
    alive: () => true,
    now: () => adesso,
    wait: (ms) => {
      adesso += ms;

      return Promise.resolve();
    },
    timeoutMs: 1_000,
    intervalMs: 100,
    ...overrides,
  };
}

describe('attesa che l-applicazione sia pronta', () => {
  it('non dichiara pronto prima che la salute risponda', async () => {
    const eventi: string[] = [];
    let risposte = 0;

    const esito = await waitUntilReady(
      porta({
        probe: () => {
          risposte += 1;
          eventi.push(`probe ${String(risposte)}`);

          // Pronto solo al terzo tentativo: i primi due sono la finestra in
          // cui il processo esiste ma l'applicazione non serve ancora.
          return Promise.resolve(risposte === 3);
        },
      }),
    );

    eventi.push('browser');

    assert.equal(esito.kind, 'pronto');
    assert.equal(esito.kind === 'pronto' ? esito.attempts : 0, 3);
    // L'ordine è la garanzia: l'apertura del browser viene dopo la risposta
    // positiva, non dopo un'attesa a tempo.
    assert.deepEqual(eventi, ['probe 1', 'probe 2', 'probe 3', 'browser']);
  });

  it('si accorge subito se il processo è terminato', async () => {
    let vivo = true;

    const esito = await waitUntilReady(
      porta({
        alive: () => vivo,
        probe: () => {
          // Il processo muore *durante* il tentativo: senza il secondo
          // controllo si attenderebbe un intervallo in più per accorgersene.
          vivo = false;

          return Promise.resolve(false);
        },
      }),
    );

    assert.equal(esito.kind, 'terminato');
    assert.equal(esito.kind === 'terminato' ? esito.attempts : -1, 1);
  });

  it('non interroga nemmeno una volta un processo già morto', async () => {
    const p = porta({ alive: () => false });

    const esito = await waitUntilReady(p);

    assert.equal(esito.kind, 'terminato');
    assert.deepEqual(p.tentativi, [], 'una porta chiusa costa un timeout per ogni giro');
  });

  it('rinuncia alla scadenza dicendo quanto ha atteso', async () => {
    const esito = await waitUntilReady(porta({ timeoutMs: 500, intervalMs: 100 }));

    assert.equal(esito.kind, 'scaduto');
    assert.ok(esito.kind === 'scaduto' && esito.elapsedMs >= 500);
    assert.ok(esito.kind === 'scaduto' && esito.attempts >= 5);
  });

  it('è pronto al primo colpo se l-applicazione risponde subito', async () => {
    const esito = await waitUntilReady(porta({ probe: () => Promise.resolve(true) }));

    assert.equal(esito.kind, 'pronto');
    assert.equal(esito.kind === 'pronto' ? esito.attempts : 0, 1);
  });
});

describe('la sonda su /api/health', () => {
  it('riconosce la risposta dell-applicazione', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
    });
    aperti.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as { port: number };

    assert.equal(await httpHealthProbe(`http://127.0.0.1:${String(port)}/api/health`), true);
  });

  it('non si fida di un 200 che non dice di essere in salute', async () => {
    const server = createServer((_req, res) => {
      // Un proxy, una pagina di cortesia, un altro programma su quella porta:
      // risponde 200 e non è la nostra applicazione.
      res.end('<html>Benvenuto</html>');
    });
    aperti.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as { port: number };

    assert.equal(await httpHealthProbe(`http://127.0.0.1:${String(port)}/api/health`), false);
  });

  it('tratta un errore di connessione come "non ancora"', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as { port: number };
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    assert.equal(await httpHealthProbe(`http://127.0.0.1:${String(port)}/api/health`, 500), false);
  });

  it('non resta appesa su un server che non risponde', async () => {
    const server = createServer(() => {
      // Nessuna risposta, mai: è il caso di un'applicazione bloccata
      // all'avvio, e la sonda deve rinunciare da sé.
    });
    aperti.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as { port: number };

    const inizio = Date.now();
    assert.equal(await httpHealthProbe(`http://127.0.0.1:${String(port)}/api/health`, 300), false);
    assert.ok(Date.now() - inizio < 5_000);
  });
});

after(async () => {
  for (const server of aperti) {
    if (server.listening) {
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      });
    }
  }
});
