import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import { describe, it } from 'node:test';
import type { DatabaseCloseOutcome } from './db/client.js';
import type { Logger } from './shared/logger.js';
import { createShutdown, installSignalHandlers } from './shutdown.js';

/**
 * Unit test dell'arresto: nessun database e nessun logger reali.
 *
 * Tutto ciò che `createShutdown` tocca arriva da fuori, quindi qui si osserva
 * l'ordine delle chiamate senza terminare il processo né aprire file.
 */

const consolidato: DatabaseCloseOutcome = {
  checkpointed: true,
  walPages: 0,
  movedPages: 0,
  alreadyClosed: false,
};

function loggerFinto(): { log: Logger; righe: [string, string][] } {
  const righe: [string, string][] = [];
  const log: Logger = {
    info(message: string) {
      righe.push(['info', message]);
    },
    error(message: string) {
      righe.push(['error', message]);
    },
  };
  return { log, righe };
}

async function serverReale(): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

describe('createShutdown', () => {
  it('ferma le attività prima di chiudere il database ed esce con 0', async () => {
    const server = await serverReale();
    const ordine: string[] = [];
    const { log } = loggerFinto();

    const codice = await new Promise<number>((resolve) => {
      const richiedi = createShutdown({
        server,
        background: { stop: () => ordine.push('stop') },
        closeDatabase: () => {
          ordine.push('closeDatabase');
          return consolidato;
        },
        exit: (code) => {
          ordine.push(`exit ${String(code)}`);
          resolve(code);
        },
        log,
      });
      richiedi('test');
    });

    assert.equal(codice, 0);
    assert.deepEqual(ordine, ['stop', 'closeDatabase', 'exit 0']);
    assert.equal(server.listening, false);
  });

  it('è idempotente per istanza', async () => {
    const server = await serverReale();
    const { log, righe } = loggerFinto();
    let stop = 0;
    let uscite = 0;

    await new Promise<void>((resolve) => {
      const richiedi = createShutdown({
        server,
        background: { stop: () => (stop += 1) },
        closeDatabase: () => consolidato,
        exit: () => {
          uscite += 1;
          resolve();
        },
        log,
      });
      richiedi('a');
      richiedi('b');
    });

    assert.equal(stop, 1);
    assert.equal(uscite, 1);
    assert.deepEqual(
      righe.filter(([, messaggio]) => messaggio.startsWith('Arresto richiesto')),
      [['info', 'Arresto richiesto (a)']],
    );
  });

  it('due istanze sono indipendenti', async () => {
    const codici: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      const server = await serverReale();
      const { log } = loggerFinto();
      const codice = await new Promise<number>((resolve) => {
        createShutdown({ server, closeDatabase: () => consolidato, exit: resolve, log })('test');
      });
      codici.push(codice);
    }
    assert.deepEqual(codici, [0, 0]);
  });

  it('closeDatabase che solleva → exit 1 e messaggio', async () => {
    const server = await serverReale();
    const { log, righe } = loggerFinto();

    const codice = await new Promise<number>((resolve) => {
      createShutdown({
        server,
        closeDatabase: () => {
          throw new Error('disco');
        },
        exit: resolve,
        log,
      })('test');
    });

    assert.equal(codice, 1);
    assert.ok(
      righe.some(([livello, m]) => livello === 'error' && m.includes('Impossibile chiudere il database')),
    );
  });

  it('WAL non consolidato → exit 0 e log di errore', async () => {
    const server = await serverReale();
    const { log, righe } = loggerFinto();

    const codice = await new Promise<number>((resolve) => {
      createShutdown({
        server,
        closeDatabase: () => ({ ...consolidato, checkpointed: false }),
        exit: resolve,
        log,
      })('test');
    });

    assert.equal(codice, 0);
    assert.ok(
      righe.some(
        ([livello, m]) => livello === 'error' && m === 'Database chiuso senza consolidare il WAL',
      ),
    );
  });

  it('stop che solleva non blocca l’arresto', async () => {
    const server = await serverReale();
    const { log, righe } = loggerFinto();

    const codice = await new Promise<number>((resolve) => {
      createShutdown({
        server,
        background: {
          stop: () => {
            throw new Error('scheduler');
          },
        },
        closeDatabase: () => consolidato,
        exit: resolve,
        log,
      })('test');
    });

    assert.equal(codice, 0);
    assert.ok(righe.some(([, m]) => m === 'Impossibile fermare le attività periodiche'));
  });

  it('rete di sicurezza', async () => {
    // Un server che non si chiude mai: `close` non richiama la callback.
    const server = {
      close() {},
      closeIdleConnections() {},
      closeAllConnections() {},
    } as unknown as Server;
    const { log } = loggerFinto();
    let chiuso = false;

    // Il timer di sicurezza non è `unref`: scattando, lascia il ciclo libero.
    const codice = await new Promise<number>((resolve) => {
      createShutdown({
        server,
        closeDatabase: () => {
          chiuso = true;
          return consolidato;
        },
        exit: resolve,
        log,
        graceMs: 10,
        safetyMs: 50,
      })('test');
    });

    assert.equal(codice, 1);
    assert.equal(chiuso, false);
  });
});

describe('installSignalHandlers', () => {
  it('registra SIGINT, SIGTERM, SIGHUP e SIGBREAK', () => {
    const emitter = new EventEmitter();
    const richieste: string[] = [];
    installSignalHandlers((motivo) => richieste.push(motivo), emitter);

    for (const segnale of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
      emitter.emit(segnale);
    }

    assert.deepEqual(richieste, ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']);
  });
});
