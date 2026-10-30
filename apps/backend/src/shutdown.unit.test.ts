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

function timerFinto() {
  const setTimeoutOriginale = globalThis.setTimeout;
  const clearTimeoutOriginale = globalThis.clearTimeout;
  const timers: {
    callback: () => void;
    delay: number;
    handle: NodeJS.Timeout;
    flags: { unrefChiamato: boolean; cancellato: boolean };
  }[] = [];

  globalThis.setTimeout = ((callback: () => void, delay = 0) => {
    const timer = {
      callback,
      delay,
      handle: undefined as unknown as NodeJS.Timeout,
      flags: { unrefChiamato: false, cancellato: false },
    };
    timer.handle = {
      unref() {
        timer.flags.unrefChiamato = true;
        return this;
      },
    } as unknown as NodeJS.Timeout;
    timers.push(timer);
    return timer.handle;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((handle: NodeJS.Timeout) => {
    const timer = timers.find((scheduled) => scheduled.handle === handle);
    if (timer !== undefined) {
      timer.flags.cancellato = true;
    }
  }) as typeof globalThis.clearTimeout;

  return {
    timers,
    run(delay: number) {
      const timer = timers.find(
        (scheduled) => scheduled.delay === delay && !scheduled.flags.cancellato,
      );
      assert.ok(timer, `timer di ${String(delay)}ms atteso`);
      timer.callback();
    },
    restore() {
      globalThis.setTimeout = setTimeoutOriginale;
      globalThis.clearTimeout = clearTimeoutOriginale;
    },
  };
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
    const timer = timerFinto();
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

    try {
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
      timer.run(5);
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
      assert.ok(timer.timers.every(({ flags }) => flags.cancellato));
    } finally {
      timer.restore();
    }
  });

  it('avvia prima la rete di sicurezza e cancella entrambi i timer al completamento', async () => {
    const timer = timerFinto();
    const ordine: string[] = [];

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
          closeDatabase: () => {
            assert.ok(timer.timers.every(({ flags }) => !flags.cancellato));
            return consolidato;
          },
          exit: (code) => {
            assert.ok(timer.timers.every(({ flags }) => flags.cancellato));
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
        'close HTTP',
        'chiudi inattive',
      ]);
      assert.deepEqual(
        timer.timers.map(({ delay }) => delay),
        [15_000, 5_000],
      );
      assert.deepEqual(
        timer.timers.map(({ flags }) => flags.unrefChiamato),
        [false, true],
      );

      callbackClose?.();
      callbackClose?.();
      assert.equal(await codice, 0);
      assert.equal(uscite, 1);
      assert.ok(timer.timers.every(({ flags }) => flags.cancellato));
    } finally {
      timer.restore();
    }
  });

  it('non programma la chiusura forzata se il callback HTTP è immediato', () => {
    const timer = timerFinto();
    const { log } = loggerFinto();
    let closeDatabaseCalls = 0;
    let exitCalls = 0;
    let closeAllCalls = 0;
    const server = {
      close(callback?: (error?: Error) => void) {
        callback?.();
      },
      closeIdleConnections() {},
      closeAllConnections() {
        closeAllCalls += 1;
      },
    } as unknown as Server;

    try {
      createShutdown({
        server,
        closeDatabase: () => {
          closeDatabaseCalls += 1;
          return consolidato;
        },
        exit: () => {
          exitCalls += 1;
        },
        log,
      })('test');

      assert.deepEqual(timer.timers.map(({ delay }) => delay), [15_000]);
      assert.equal(timer.timers[0]?.flags.cancellato, true);
      timer.timers[0]?.callback();
      assert.equal(closeDatabaseCalls, 1);
      assert.equal(exitCalls, 1);
      assert.equal(closeAllCalls, 0);
    } finally {
      timer.restore();
    }
  });

  it('un errore sincrono in server.close chiude il database e termina una volta con 1', () => {
    const timer = timerFinto();
    const { log, righe } = loggerFinto();
    let closeDatabaseCalls = 0;
    let exitCalls = 0;
    const server = {
      close() {
        throw new Error('HTTP sincrono');
      },
      closeIdleConnections() {},
      closeAllConnections() {},
    } as unknown as Server;

    try {
      createShutdown({
        server,
        closeDatabase: () => {
          closeDatabaseCalls += 1;
          return consolidato;
        },
        exit(code) {
          assert.equal(code, 1);
          exitCalls += 1;
        },
        log,
      })('test');

      assert.equal(closeDatabaseCalls, 1);
      assert.equal(exitCalls, 1);
      assert.ok(timer.timers.every(({ flags }) => flags.cancellato));
      assert.ok(
        righe.some(([level, message]) => level === 'error' && message.includes('server HTTP')),
      );
    } finally {
      timer.restore();
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
    const timer = timerFinto();
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
    try {
      const codice = new Promise<number>((resolve) => {
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

      assert.equal(timer.timers.find(({ delay }) => delay === 30)?.flags.unrefChiamato, false);
      timer.run(30);
      assert.equal(await codice, 1);
      assert.equal(chiuso, false);
      callbackClose?.();
      timer.timers.find(({ delay }) => delay === 30)?.callback();
      assert.equal(uscite, 1);
    } finally {
      timer.restore();
    }
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
