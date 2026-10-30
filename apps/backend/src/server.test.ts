import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, describe, it } from 'node:test';
import { ListenFailedError, listenWithFallback, type ListenRequest } from './listen.js';
import {
  startServer,
  StartupFailedError,
  type ServerDeps,
  type StartOptions,
  type StartupPhase,
} from './server.js';

/**
 * L'avvio del server.
 *
 * Nessun database e nessun logger vero: `startServer` riceve tutto da fuori,
 * ed è per questo che l'ordine delle fasi e i messaggi si possono verificare.
 * I server HTTP sono veri, su una porta assegnata dal kernel.
 */

const HOST = '127.0.0.1';
const options: StartOptions = { host: HOST, port: 0, allowFallback: false };

/** Ogni server creato nei test, chiuso alla fine anche se il test fallisce. */
const aperti: Server[] = [];

const chiudi = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.closeAllConnections();
    server.close(() => {
      resolve();
    });
  });

after(async () => {
  await Promise.all(aperti.map(chiudi));
});

interface Registro {
  readonly ordine: string[];
  readonly info: string[];
  readonly errori: string[];
  readonly richieste: ListenRequest[];
  readonly server: Server[];
  readonly deps: ServerDeps;
}

interface Variazioni {
  readonly bootstrap?: () => void;
  readonly listen?: ServerDeps['listen'];
  readonly start?: () => void;
  readonly stop?: () => void;
}

/** Dipendenze finte che annotano ciò che accade, con la possibilità di guastarne una. */
function nuovoRegistro(variazioni: Variazioni = {}): Registro {
  const ordine: string[] = [];
  const info: string[] = [];
  const errori: string[] = [];
  const richieste: ListenRequest[] = [];
  const server: Server[] = [];

  const deps: ServerDeps = {
    bootstrap: () => {
      ordine.push('bootstrap');
      variazioni.bootstrap?.();
    },
    createApp: () => {
      ordine.push('createApp');

      return (_req, res) => {
        res.end('app di prova');
      };
    },
    listen: async (srv, richiesta) => {
      ordine.push('listen');
      richieste.push(richiesta);
      server.push(srv);
      aperti.push(srv);

      return (variazioni.listen ?? listenWithFallback)(srv, richiesta);
    },
    createScheduler: () => ({
      start: () => {
        ordine.push('scheduler.start');
        variazioni.start?.();
      },
      stop: () => {
        ordine.push('scheduler.stop');
        variazioni.stop?.();
      },
    }),
    log: {
      info: (message: string) => {
        info.push(message);
      },
      error: (message: string) => {
        errori.push(message);
      },
    },
  };

  return { ordine, info, errori, richieste, server, deps };
}

/** L'errore con cui `startServer` fallisce, di cui si vuole leggere la fase. */
async function fallimento(registro: Registro): Promise<StartupFailedError> {
  try {
    await startServer(options, registro.deps);
  } catch (error) {
    assert.ok(error instanceof StartupFailedError, 'ci si aspetta StartupFailedError');

    return error;
  }

  throw new Error('startServer doveva fallire');
}

const fase = (error: StartupFailedError): StartupPhase => error.phase;

describe('avvio del server', () => {
  it("esegue bootstrap, app, listen e scheduler in quest'ordine", async () => {
    const registro = nuovoRegistro();
    await startServer(options, registro.deps);

    assert.deepEqual(registro.ordine, ['bootstrap', 'createApp', 'listen', 'scheduler.start']);
  });

  it("il server serve l'applicazione ricevuta", async () => {
    const registro = nuovoRegistro();
    const avviato = await startServer(options, registro.deps);

    const risposta = await fetch(`http://${HOST}:${String(avviato.listen.actualPort)}/`);

    assert.equal(await risposta.text(), 'app di prova');
  });

  it('passa host, porta e permesso di ripiego al listen', async () => {
    for (const allowFallback of [false, true]) {
      const registro = nuovoRegistro();
      await startServer({ host: HOST, port: 0, allowFallback }, registro.deps);

      assert.deepEqual(registro.richieste, [{ host: HOST, port: 0, allowFallback }]);
    }
  });

  it("restituisce l'esito del listen e lo scheduler come attività di sfondo", async () => {
    const registro = nuovoRegistro();
    const avviato = await startServer(options, registro.deps);

    assert.equal(avviato.server, registro.server[0]);
    assert.equal(avviato.listen.host, HOST);
    assert.equal(avviato.listen.fellBack, false);

    avviato.background.stop();

    assert.ok(registro.ordine.includes('scheduler.stop'));
  });

  it('registra il ripiego', async () => {
    const registro = nuovoRegistro({
      listen: async (srv) => {
        const esito = await listenWithFallback(srv, {
          host: HOST,
          port: 0,
          allowFallback: false,
        });

        return { ...esito, fellBack: true, configuredPort: 3000 };
      },
    });
    const avviato = await startServer(options, registro.deps);

    assert.ok(
      registro.info.includes(
        `La porta 3000 era occupata: il server usa la ${String(avviato.listen.actualPort)}`,
      ),
    );
  });

  it('bootstrap fallito: niente listen', async () => {
    const registro = nuovoRegistro({
      bootstrap: () => {
        throw new Error('archivio rotto');
      },
    });
    const errore = await fallimento(registro);

    assert.equal(fase(errore), 'bootstrap');
    assert.ok(!registro.ordine.includes('listen'));
    assert.ok(registro.errori.includes('Avvio interrotto: archivio rotto'));
  });

  it("porta occupata: messaggio per l'utente e niente scheduler", async () => {
    const errno: NodeJS.ErrnoException = Object.assign(new Error('in uso'), {
      code: 'EADDRINUSE',
    });
    const registro = nuovoRegistro({
      listen: () => Promise.reject(new ListenFailedError('x', 47318, 'EADDRINUSE', errno)),
    });
    const errore = await fallimento(registro);

    assert.equal(fase(errore), 'listen');
    assert.ok(
      registro.errori.some(
        (m) =>
          m.includes('La porta 47318 è già occupata da un altro programma') &&
          m.includes('MYFINANCE_PORT'),
      ),
    );
    assert.ok(!registro.ordine.includes('scheduler.start'));
  });

  it('altro errore di listen: messaggio generico', async () => {
    const errno: NodeJS.ErrnoException = Object.assign(new Error('negato'), {
      code: 'EACCES',
    });
    const registro = nuovoRegistro({
      listen: () => Promise.reject(new ListenFailedError('x', 80, 'EACCES', errno)),
    });
    const errore = await fallimento(registro);

    assert.equal(fase(errore), 'listen');
    assert.ok(
      registro.errori.some((m) => m.includes(`Impossibile mettersi in ascolto su ${HOST}:`)),
    );
  });

  it('scheduler fallito: server chiuso e scheduler fermato', async () => {
    const registro = nuovoRegistro({
      start: () => {
        throw new Error('pianificazione non valida');
      },
    });
    const errore = await fallimento(registro);

    assert.equal(fase(errore), 'scheduler');
    assert.ok(registro.ordine.includes('scheduler.stop'));
    assert.equal(registro.server[0]?.listening, false);
    assert.ok(registro.errori.includes('Impossibile avviare i backup automatici'));
  });
});
