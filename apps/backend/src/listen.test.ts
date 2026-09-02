import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { ListenFailedError, listenWithFallback } from './listen.js';

/**
 * La scelta della porta.
 *
 * Non serve un database né l'applicazione: `listenWithFallback` riceve un
 * `http.Server` qualsiasi, ed è deliberato — la decisione sulla porta non deve
 * dipendere da cosa quel server serve.
 */

const HOST = '127.0.0.1';

const aperti: Server[] = [];

/** Un server qualsiasi, chiuso alla fine. */
function nuovoServer(): Server {
  const server = createServer((_req, res) => {
    res.end();
  });
  aperti.push(server);

  return server;
}

const chiudi = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });

describe('apertura della porta', () => {
  it('usa la porta richiesta quando è libera', async () => {
    // Una porta libera si ottiene facendosene assegnare una e restituendola:
    // chiedere "è libera la 3000?" sarebbe una domanda su un'altra macchina.
    const sonda = nuovoServer();
    const esito0 = await listenWithFallback(sonda, { host: HOST, port: 0, allowFallback: false });
    const libera = esito0.actualPort;
    await chiudi(sonda);

    const server = nuovoServer();
    const esito = await listenWithFallback(server, {
      host: HOST,
      port: libera,
      allowFallback: true,
    });

    assert.equal(esito.configuredPort, libera);
    assert.equal(esito.actualPort, libera);
    assert.equal(esito.fellBack, false);
    assert.equal((server.address() as AddressInfo).port, libera);

    await chiudi(server);
  });

  it('con la porta occupata e il ripiego concesso ne apre un-altra', async () => {
    const occupante = nuovoServer();
    await listenWithFallback(occupante, { host: HOST, port: 0, allowFallback: false });
    const occupata = (occupante.address() as AddressInfo).port;

    const server = nuovoServer();
    const esito = await listenWithFallback(server, {
      host: HOST,
      port: occupata,
      allowFallback: true,
    });

    assert.equal(esito.configuredPort, occupata);
    assert.notEqual(esito.actualPort, occupata);
    assert.equal(esito.fellBack, true);
    assert.ok(esito.actualPort > 0);

    // Entrambi in ascolto: il ripiego non ha rubato la porta a nessuno.
    assert.equal((occupante.address() as AddressInfo).port, occupata);
    assert.equal((server.address() as AddressInfo).port, esito.actualPort);

    await chiudi(server);
    await chiudi(occupante);
  });

  it('con la porta occupata e il ripiego negato fallisce dicendo quale', async () => {
    const occupante = nuovoServer();
    await listenWithFallback(occupante, { host: HOST, port: 0, allowFallback: false });
    const occupata = (occupante.address() as AddressInfo).port;

    const server = nuovoServer();
    await assert.rejects(
      () => listenWithFallback(server, { host: HOST, port: occupata, allowFallback: false }),
      (error: unknown) => {
        assert.ok(error instanceof ListenFailedError);
        assert.equal(error.code, 'EADDRINUSE');
        assert.equal(error.port, occupata);
        assert.match(error.message, new RegExp(String(occupata)));

        return true;
      },
    );

    await chiudi(occupante);
  });

  it('un errore che non è la porta occupata non porta a un ripiego', async () => {
    const server = nuovoServer();

    // Un indirizzo che non appartiene a questa macchina: cambiare numero di
    // porta non lo renderebbe raggiungibile, quindi ripiegare sarebbe un modo
    // di nascondere il problema.
    await assert.rejects(
      () => listenWithFallback(server, { host: '203.0.113.1', port: 0, allowFallback: true }),
      (error: unknown) => {
        assert.ok(error instanceof ListenFailedError);
        assert.notEqual(error.code, 'EADDRINUSE');

        return true;
      },
    );
  });

  it('dopo un ripiego non restano gestori appesi sul server', async () => {
    const occupante = nuovoServer();
    await listenWithFallback(occupante, { host: HOST, port: 0, allowFallback: false });
    const occupata = (occupante.address() as AddressInfo).port;

    const server = nuovoServer();
    /*
     * La linea di partenza va misurata, non assunta.
     *
     * `http.createServer()` registra da sé un ascoltatore su `listening` —
     * `setupConnectionsTracking` — quindi il valore atteso non è zero. Ciò che
     * conta è che dopo due tentativi il conteggio sia tornato quello di prima:
     * due coppie di gestori montate e smontate. Se ne restasse una, un errore
     * successivo verrebbe interpretato come esito di un tentativo già
     * concluso.
     */
    const primaError = server.listenerCount('error');
    const primaListening = server.listenerCount('listening');

    await listenWithFallback(server, { host: HOST, port: occupata, allowFallback: true });

    assert.equal(server.listenerCount('error'), primaError);
    assert.equal(server.listenerCount('listening'), primaListening);

    await chiudi(server);
    await chiudi(occupante);
  });
});

/**
 * Un server ancora in ascolto tiene vivo il processo.
 *
 * Con la chiusura affidata a `process.on('exit')` un solo test fallito
 * lascerebbe l'intera suite appesa fino al timeout, e la causa sembrerebbe un
 * test lento invece di un handle aperto.
 */
after(async () => {
  for (const server of aperti) {
    if (server.listening) {
      await chiudi(server);
    }
  }
});
