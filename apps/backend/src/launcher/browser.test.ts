import assert from 'node:assert/strict';
import type { SpawnOptions } from 'node:child_process';
import { describe, it } from 'node:test';
import { localUrl, openInBrowser, shouldOpenBrowser } from './browser.js';

/**
 * L'apertura del browser.
 *
 * Nessun browser viene aperto: si verifica **cosa** verrebbe chiesto al
 * sistema. Un test che aprisse davvero una finestra sarebbe inutilizzabile in
 * una suite che avvia il package decine di volte.
 */

interface Invocazione {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
}

function raccogli(): { invocazioni: Invocazione[]; port: Parameters<typeof openInBrowser>[1] } {
  const invocazioni: Invocazione[] = [];

  return {
    invocazioni,
    port: {
      comspec: 'C:\\Windows\\System32\\cmd.exe',
      spawn: (command, args, options) => {
        invocazioni.push({ command, args, options });

        return {
          unref: () => {
            invocazioni.push({ command: 'unref', args: [], options: {} });
          },
        };
      },
    },
  };
}

describe('indirizzo locale', () => {
  it('usa l-indirizzo su cui il server ha detto di essere', () => {
    assert.equal(localUrl('127.0.0.1', 3000), 'http://127.0.0.1:3000/');
    assert.equal(localUrl('127.0.0.1', 47318), 'http://127.0.0.1:47318/');
  });

  it('non nomina localhost', () => {
    // Su alcune macchine `localhost` risolve prima in IPv6, mentre il server
    // ascolta sull'indirizzo IPv4 su cui è stato messo.
    assert.doesNotMatch(localUrl('127.0.0.1', 3000), /localhost/);
  });
});

describe('apertura', () => {
  it('chiede al sistema di aprire l-indirizzo, senza nominare un browser', () => {
    const { invocazioni, port } = raccogli();

    openInBrowser('http://127.0.0.1:3000/', port);

    const invocata = invocazioni[0];
    assert.ok(invocata !== undefined);
    assert.equal(invocata.command, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepEqual(invocata.args, ['/c', 'start', '', 'http://127.0.0.1:3000/']);
    // Nessun nome di programma: la scelta del browser appartiene a chi usa il
    // computer.
    assert.doesNotMatch(invocata.args.join(' '), /edge|chrome|firefox/i);
  });

  it('stacca il processo e non ne trattiene i flussi', () => {
    const { invocazioni, port } = raccogli();

    openInBrowser('http://127.0.0.1:3000/', port);

    const invocata = invocazioni[0];
    assert.equal(invocata?.options.detached, true);
    assert.equal(invocata?.options.stdio, 'ignore');
    // Senza `unref` il launcher non potrebbe uscire finché il browser è
    // aperto.
    assert.equal(invocazioni[1]?.command, 'unref');
  });

  it('cmd.exe arriva da COMSPEC, non dal PATH', () => {
    const { invocazioni, port } = raccogli();

    openInBrowser('http://127.0.0.1:3000/', port);

    assert.ok(invocazioni[0]?.command.includes('\\'), 'deve essere un percorso, non un nome');
  });
});

describe('quando non aprirlo', () => {
  it('per impostazione predefinita si apre', () => {
    assert.equal(shouldOpenBrowser({}), true);
    assert.equal(shouldOpenBrowser({ MYFINANCE_NO_BROWSER: '0' }), true);
  });

  it('un contesto automatico può sopprimerlo', () => {
    assert.equal(shouldOpenBrowser({ MYFINANCE_NO_BROWSER: '1' }), false);
  });
});
