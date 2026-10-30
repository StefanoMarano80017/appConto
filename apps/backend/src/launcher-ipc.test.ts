import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { connectLauncher, isShutdownMessage, type LauncherProcess } from './launcher-ipc.js';
import type { ListenOutcome } from './listen.js';

const listening: ListenOutcome = {
  host: '127.0.0.1',
  configuredPort: 3000,
  actualPort: 51000,
  fellBack: true,
};

type SendFn = NonNullable<LauncherProcess['send']>;

interface Fake {
  readonly proc: EventEmitter & LauncherProcess;
  readonly sent: unknown[];
  readonly requests: string[];
}

function makeFake(options: { connected?: boolean; send?: SendFn } = {}): Fake {
  const sent: unknown[] = [];
  const emitter = new EventEmitter();
  const send: SendFn =
    options.send ??
    ((message, callback) => {
      sent.push(message);
      callback(null);
      return true;
    });
  const proc = Object.assign(emitter, {
    pid: 4242,
    connected: options.connected ?? true,
    send,
  });
  return { proc, sent, requests: [] };
}

describe('isShutdownMessage', () => {
  it('riconosce solo il messaggio di arresto', () => {
    assert.equal(isShutdownMessage({ type: 'shutdown' }), true);
    assert.equal(isShutdownMessage({ type: 'shutdown', extra: 1 }), true);
    for (const value of [null, 'shutdown', {}, { type: 'ready' }, { type: 42 }, []]) {
      assert.equal(isShutdownMessage(value), false);
    }
  });
});

describe('connectLauncher', () => {
  it('invia ready con i cinque campi', () => {
    const { proc, sent, requests } = makeFake();
    const result = connectLauncher(proc, listening, (r) => requests.push(r));
    assert.equal(result, true);
    assert.deepEqual(sent, [
      {
        type: 'ready',
        host: '127.0.0.1',
        port: 51000,
        configuredPort: 3000,
        pid: 4242,
      },
    ]);
    assert.deepEqual(requests, []);
  });

  it("shutdown chiede l'arresto", () => {
    const { proc, requests } = makeFake();
    connectLauncher(proc, listening, (r) => requests.push(r));
    proc.emit('message', { type: 'shutdown' });
    assert.deepEqual(requests, ['launcher']);
  });

  it('messaggi non validi o sconosciuti ignorati', () => {
    const { proc, requests } = makeFake();
    connectLauncher(proc, listening, (r) => requests.push(r));
    for (const m of [null, 'x', { type: 'boh' }, {}]) proc.emit('message', m);
    assert.deepEqual(requests, []);
  });

  it('richieste duplicate inoltrate', () => {
    const { proc, requests } = makeFake();
    connectLauncher(proc, listening, (r) => requests.push(r));
    proc.emit('message', { type: 'shutdown' });
    proc.emit('message', { type: 'shutdown' });
    assert.deepEqual(requests, ['launcher', 'launcher']);
  });

  it("disconnect chiede l'arresto", () => {
    const { proc, requests } = makeFake();
    connectLauncher(proc, listening, (r) => requests.push(r));
    proc.emit('disconnect');
    assert.deepEqual(requests, ['launcher disconnesso']);
  });

  it('canale già chiuso', () => {
    const { proc, requests } = makeFake({ connected: false });
    assert.doesNotThrow(() => connectLauncher(proc, listening, (r) => requests.push(r)));
    assert.deepEqual(requests, ['launcher disconnesso']);
  });

  it('send con errore nella callback', () => {
    const { proc, requests } = makeFake({
      send: (_m, callback) => {
        callback(new Error('EPIPE'));
        return false;
      },
    });
    assert.doesNotThrow(() => connectLauncher(proc, listening, (r) => requests.push(r)));
    assert.deepEqual(requests, ['launcher disconnesso']);
  });

  it('send che solleva', () => {
    const { proc, requests } = makeFake({
      send: () => {
        throw new Error('ERR_IPC_CHANNEL_CLOSED');
      },
    });
    assert.doesNotThrow(() => connectLauncher(proc, listening, (r) => requests.push(r)));
    assert.deepEqual(requests, ['launcher disconnesso']);
  });

  it('senza IPC', () => {
    const emitter = new EventEmitter();
    const proc = Object.assign(emitter, { pid: 4242 });
    const requests: string[] = [];
    assert.equal(
      connectLauncher(proc, listening, (r) => requests.push(r)),
      false,
    );
    assert.equal(emitter.listenerCount('message'), 0);
    assert.equal(emitter.listenerCount('disconnect'), 0);
    assert.deepEqual(requests, []);
  });
});
