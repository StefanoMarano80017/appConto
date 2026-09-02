import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { CONTROL_PROTOCOL, type ControlRequest, type ControlResponse } from './control.js';
import { arrestaIstanza, presentaArresto } from './stop.js';

/**
 * `stop.bat`, cioè l'arresto chiesto da fuori.
 *
 * Il canale è iniettato: ciò che va provato è come si interpreta il lock e
 * cosa si fa di ciascuna risposta possibile, compreso il silenzio.
 */

const temporanee: string[] = [];

function radice(nome: string): string {
  const creata = mkdtempSync(path.join(tmpdir(), `appconto-stop-${nome}-`));
  temporanee.push(creata);

  return creata;
}

function scriviLock(dataRoot: string, extra: Record<string, unknown> = {}): string {
  const file = path.join(dataRoot, 'instance.lock');
  writeFileSync(
    file,
    JSON.stringify({
      protocol: CONTROL_PROTOCOL,
      pid: 4242,
      startedAt: '2026-09-02T10:00:00.000Z',
      appRoot: 'C:\\MyFinance',
      dataRoot,
      controlPort: 51234,
      token: 'il-segreto',
      serverPort: 3000,
      ...extra,
    }),
    'utf8',
  );

  return file;
}

describe('richiesta di arresto', () => {
  it('trova l-istanza dal lock e le manda il token', async () => {
    const dati = radice('ok');
    const file = scriviLock(dati);
    const chieste: { port: number; request: ControlRequest }[] = [];

    const esito = await arrestaIstanza({
      lockFile: file,
      ask: (port, request) => {
        chieste.push({ port, request });

        return Promise.resolve<ControlResponse>({ ok: true, accepted: 'shutdown' });
      },
    });

    assert.deepEqual(esito, { kind: 'arrestata', pid: 4242 });
    // La porta e il token vengono dal lock: nessuna seconda deduzione.
    assert.deepEqual(chieste, [
      { port: 51234, request: { cmd: 'shutdown', token: 'il-segreto' } },
    ]);
  });

  it('senza lock non c-è niente da fermare', async () => {
    const esito = await arrestaIstanza({
      lockFile: path.join(radice('vuota'), 'instance.lock'),
      ask: () => {
        throw new Error('non deve essere interrogato niente');
      },
    });

    assert.deepEqual(esito, { kind: 'nessuna-istanza' });
  });

  it('un lock illeggibile equivale a nessuna istanza', async () => {
    const dati = radice('rotta');
    const file = path.join(dati, 'instance.lock');
    writeFileSync(file, 'spazzatura', 'utf8');

    const esito = await arrestaIstanza({
      lockFile: file,
      ask: () => {
        throw new Error('non deve essere interrogato niente');
      },
    });

    assert.deepEqual(esito, { kind: 'nessuna-istanza' });
  });

  it('un lock che non risponde è un residuo, e non viene rimosso da qui', async () => {
    const dati = radice('residuo');
    const file = scriviLock(dati);

    const esito = await arrestaIstanza({ lockFile: file, ask: () => Promise.resolve(null) });

    assert.deepEqual(esito, { kind: 'non-risponde', pid: 4242 });
    // Rimuoverlo qui sarebbe una corsa con un avvio in corso: solo chi riesce
    // a crearlo con `wx` può dichiararsene il proprietario.
    assert.equal(presentaArresto(esito).code, 0);
  });

  it('un rifiuto viene riportato con il motivo', async () => {
    const dati = radice('rifiuto');
    const file = scriviLock(dati);

    const esito = await arrestaIstanza({
      lockFile: file,
      ask: () => Promise.resolve<ControlResponse>({ ok: false, problem: 'token non valido' }),
    });

    assert.deepEqual(esito, { kind: 'rifiutata', problem: 'token non valido' });
    assert.equal(presentaArresto(esito).code, 1);
  });
});

describe('messaggi', () => {
  it('ogni esito ha un messaggio, e solo il rifiuto è un errore', () => {
    const casi = [
      { kind: 'nessuna-istanza' as const, code: 0 },
      { kind: 'arrestata' as const, pid: 1, code: 0 },
      { kind: 'non-risponde' as const, pid: 1, code: 0 },
      { kind: 'rifiutata' as const, problem: 'x', code: 1 },
    ];

    for (const caso of casi) {
      const { testo, code } = presentaArresto(caso);
      assert.ok(testo.length > 0, `${caso.kind} deve avere un messaggio`);
      assert.equal(code, caso.code, `${caso.kind} deve uscire con ${String(caso.code)}`);
    }
  });
});

after(() => {
  for (const cartella of temporanee) {
    rmSync(cartella, { recursive: true, force: true });
  }
});
