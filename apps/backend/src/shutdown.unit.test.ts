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
    const { log, righe } = loggerFinto();

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
    assert.ok(righe.some(([livello, m]) => livello === 'info' && m === 'Arresto completato'));
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
    assert.ok(
      !righe.some(([, m]) => m === 'Arresto completato'),
      'un arresto fallito non deve dichiararsi completato',
    );
  });

  it('WAL non consolidato → exit 1 e log di errore', async () => {
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

    assert.equal(codice, 1);
    assert.ok(
      righe.some(
        ([livello, m]) => livello === 'error' && m === 'Database chiuso senza consolidare il WAL',
      ),
    );
  });

  it('attende il timeout di grazia prima di chiudere il database', async () => {
    const ordine: string[] = [];
    let callbackClose: ((error?: Error) => void) | undefined;
    const server = {
      close(callback?: (error?: Error) => void) {
        ordine.push('close HTTP');
        callbackClose = callback;
      },
      closeIdleConnections() {
        ordine.push('chiudi inattive');
      },
      closeAllConnections() {
        ordine.push('chiudi forzatamente');
      },
    } as unknown as Server;
    const { log } = loggerFinto();

    const codice = new Promise<number>((resolve) => {
      createShutdown({
        server,
        background: { stop: () => ordine.push('stop') },
        closeDatabase: () => {
          ordine.push('database');
          return consolidato;
        },
        exit: (code) => {
          ordine.push(`exit ${String(code)}`);
          resolve(code);
        },
        log,
        graceMs: 5,
        safetyMs: 500,
      })('test');
    });

    assert.deepEqual(ordine, ['stop', 'close HTTP', 'chiudi inattive']);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(ordine, [
      'stop',
      'close HTTP',
      'chiudi inattive',
      'chiudi forzatamente',
    ]);

    callbackClose?.();
    assert.equal(await codice, 0);
    assert.deepEqual(ordine, [
      'stop',
      'close HTTP',
      'chiudi inattive',
      'chiudi forzatamente',
      'database',
      'exit 0',
    ]);
  });

  it('avvia prima la rete di sicurezza e cancella entrambi i timer al completamento', async () => {
    const timerOriginale = globalThis.setTimeout;
    const clearTimeoutOriginale = globalThis.clearTimeout;
    const ordine: string[] = [];
    const timerCreati: {
      handle: NodeJS.Timeout;
      delay: number;
      flags: { unrefChiamato: boolean; cancellato: boolean };
    }[] = [];
    globalThis.setTimeout = ((callback: () => void, delay = 0) => {
      ordine.push(`timer ${String(delay)}`);
      const flags = {
        unrefChiamato: false,
        cancellato: false,
      };
      const timer = {
        callback,
        delay,
        unref() {
          flags.unrefChiamato = true;
          return this;
        },
      };
      const handle = timer as unknown as NodeJS.Timeout;
      timerCreati.push({ handle, delay, flags });
      return handle;
    }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((handle: NodeJS.Timeout) => {
      const timer = timerCreati.find((scheduled) => scheduled.handle === handle);
      if (timer !== undefined) {
        timer.flags.cancellato = true;
      }
    }) as typeof globalThis.clearTimeout;

    try {
      let callbackClose: ((error?: Error) => void) | undefined;
      let uscite = 0;
      const server = {
        close(callback?: (error?: Error) => void) {
          ordine.push('close HTTP');
          callbackClose = callback;
        },
        closeIdleConnections() {
          ordine.push('chiudi inattive');
        },
        closeAllConnections() {},
      } as unknown as Server;
      const { log } = loggerFinto();

      const codice = new Promise<number>((resolve) => {
        createShutdown({
          server,
          background: { stop: () => ordine.push('stop') },
          closeDatabase: () => consolidato,
          exit: (code) => {
            uscite += 1;
            resolve(code);
          },
          log,
          graceMs: 5_000,
          safetyMs: 15_000,
        })('test');
      });

      assert.deepEqual(ordine, [
        'stop',
        'timer 15000',
        'close HTTP',
        'chiudi inattive',
        'timer 5000',
      ]);
      assert.deepEqual(
        timerCreati.map(({ delay }) => delay),
        [15_000, 5_000],
      );
      assert.deepEqual(
        timerCreati.map(({ flags }) => flags.unrefChiamato),
        [false, true],
      );

      callbackClose?.();
      callbackClose?.();
      assert.equal(await codice, 0);
      assert.equal(uscite, 1);
      assert.ok(timerCreati.every(({ flags }) => flags.cancellato));
    } finally {
      globalThis.setTimeout = timerOriginale;
      globalThis.clearTimeout = clearTimeoutOriginale;
    }
  });

  it('un errore di chiusura HTTP porta a exit 1', async () => {
    const server = {
      close(callback?: (error?: Error) => void) {
        setImmediate(() => callback?.(new Error('HTTP')));
      },
      closeIdleConnections() {},
      closeAllConnections() {},
    } as unknown as Server;
    const { log, righe } = loggerFinto();

    const codice = await new Promise<number>((resolve) => {
      createShutdown({
        server,
        closeDatabase: () => consolidato,
        exit: resolve,
        log,
      })('test');
    });

    assert.equal(codice, 1);
    assert.ok(
      righe.some(([livello, messaggio]) => livello === 'error' && messaggio.includes('server HTTP')),
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
    let callbackClose: ((error?: Error) => void) | undefined;
    const server = {
      close(callback?: (error?: Error) => void) {
        callbackClose = callback;
      },
      closeIdleConnections() {},
      closeAllConnections() {},
    } as unknown as Server;
    const { log } = loggerFinto();
    let chiuso = false;
    let uscite = 0;

    // Il timer di sicurezza non è `unref`: scattando, lascia il ciclo libero.
    const codice = await new Promise<number>((resolve) => {
      createShutdown({
        server,
        closeDatabase: () => {
          chiuso = true;
          return consolidato;
        },
        exit: (code) => {
          uscite += 1;
          resolve(code);
        },
        log,
        graceMs: 10,
        safetyMs: 30,
      })('test');
    });

    assert.equal(codice, 1);
    assert.equal(chiuso, false);
    callbackClose?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(uscite, 1);
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
