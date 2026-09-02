import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBackupName, type BackupKind } from './backup.naming.js';
import { RETENTION, backupsToPrune, isoWeekKey } from './backup.retention.js';

/**
 * La politica di ritenzione.
 *
 * È l'unica parte del sistema di backup autorizzata a cancellare qualcosa,
 * quindi è anche quella che deve essere verificabile per esteso. Essendo una
 * funzione da nomi a nomi, lo è: nessun file viene creato in questo file.
 */

/** `<tipo>-<giorno>-<ora>.sqlite` per una serie di giorni consecutivi. */
function giorniConsecutivi(kind: BackupKind, dal: string, quanti: number): string[] {
  const [anno, mese, giorno] = [dal.slice(0, 4), dal.slice(4, 6), dal.slice(6, 8)].map(Number);
  const nomi: string[] = [];

  for (let indice = 0; indice < quanti; indice += 1) {
    const data = new Date(Date.UTC(anno ?? 0, (mese ?? 1) - 1, (giorno ?? 1) - indice));
    const stampa = data.toISOString().slice(0, 10).replaceAll('-', '');
    nomi.push(`${kind}-${stampa}-030000.sqlite`);
  }

  return nomi;
}

const conservati = (nomi: readonly string[]): string[] => {
  const eliminati = new Set(backupsToPrune(nomi));

  return nomi.filter((nome) => !eliminati.has(nome)).sort().reverse();
};

describe('settimana ISO ricavata dal giorno', () => {
  it('mercoledì e il lunedì precedente stanno nella stessa settimana', () => {
    assert.equal(isoWeekKey('20260901'), '2026-W36');
    assert.equal(isoWeekKey('20260831'), '2026-W36');
  });

  it('la domenica appartiene alla settimana che finisce, non a quella che comincia', () => {
    assert.equal(isoWeekKey('20260830'), '2026-W35');
  });

  it('la prima settimana dell-anno è quella del primo giovedì', () => {
    assert.equal(isoWeekKey('20251229'), '2026-W01');
    assert.equal(isoWeekKey('20260101'), '2026-W01');
    assert.equal(isoWeekKey('20260104'), '2026-W01');
    assert.equal(isoWeekKey('20260105'), '2026-W02');
  });

  it('un capodanno può appartenere alla settimana dell-anno precedente', () => {
    assert.equal(isoWeekKey('20270101'), '2026-W53');
  });
});

describe('pre-migration: si conservano gli ultimi cinque', () => {
  it('elimina i più vecchi e tiene i cinque più recenti', () => {
    const nomi = giorniConsecutivi('pre-migration', '20260901', 9);
    const restano = conservati(nomi);

    assert.equal(RETENTION['pre-migration'], 5);
    assert.equal(restano.length, 5);
    assert.deepEqual(restano, nomi.slice(0, 5));
  });

  it('con meno di cinque non elimina nulla', () => {
    const nomi = giorniConsecutivi('pre-migration', '20260901', 3);
    assert.deepEqual(backupsToPrune(nomi), []);
  });
});

describe('pre-restore: si conservano gli ultimi tre', () => {
  it('tiene i tre più recenti', () => {
    const nomi = giorniConsecutivi('pre-restore', '20260901', 6);
    const restano = conservati(nomi);

    assert.equal(RETENTION['pre-restore'], 3);
    assert.deepEqual(restano, nomi.slice(0, 3));
  });
});

describe('manual: non si cancella ciò che ha chiesto l-utente', () => {
  it('cinquanta backup manuali restano cinquanta', () => {
    const nomi = giorniConsecutivi('manual', '20260901', 50);

    assert.equal(RETENTION.manual, null);
    assert.deepEqual(backupsToPrune(nomi), []);
  });
});

describe('auto: sette giornalieri e quattro settimanali', () => {
  it('di più backup nello stesso giorno resta il più recente', () => {
    const nomi = [
      'auto-20260901-010000.sqlite',
      'auto-20260901-120000.sqlite',
      'auto-20260901-235959.sqlite',
    ];

    assert.deepEqual(conservati(nomi), ['auto-20260901-235959.sqlite']);
  });

  it('due mesi di backup giornalieri si riducono a una decina', () => {
    const nomi = giorniConsecutivi('auto', '20260901', 60);
    const restano = conservati(nomi);

    // I sette giorni più recenti ci sono tutti.
    for (const atteso of nomi.slice(0, 7)) {
      assert.ok(restano.includes(atteso), `manca il giornaliero ${atteso}`);
    }

    // Gli slot settimanali estendono la copertura oltre la settimana corrente
    // senza conservare un file per ogni giorno del mese.
    assert.ok(restano.length >= 7 && restano.length <= 11, `conservati ${String(restano.length)}`);

    const settimane = new Set(
      restano.map((nome) => isoWeekKey(parseBackupName(nome)?.day ?? '')),
    );
    assert.ok(settimane.size >= 4, 'la copertura deve arrivare a quattro settimane');

    // Nulla di più vecchio di cinque settimane sopravvive.
    const piuVecchio = restano[restano.length - 1] ?? '';
    assert.ok(piuVecchio > 'auto-20260725', `troppo vecchio: ${piuVecchio}`);
  });

  it('un mese di backup settimanali resta intero', () => {
    // Uno ogni sette giorni: quattro settimane distinte, quindi tutti dentro
    // gli slot settimanali.
    const nomi = [
      'auto-20260901-030000.sqlite',
      'auto-20260825-030000.sqlite',
      'auto-20260818-030000.sqlite',
      'auto-20260811-030000.sqlite',
    ];

    assert.deepEqual(backupsToPrune(nomi), []);
  });
});

describe('ciò che la politica non riconosce, non lo tocca', () => {
  it('ignora nomi estranei, partial e manifest', () => {
    const estranei = [
      'database.sqlite',
      'manual-20260901-143012.sqlite.partial',
      'pre-migration-20260901-143012.json',
      'appunti.txt',
      'replaced-20260901-143012.sqlite',
    ];
    const nomi = [...giorniConsecutivi('pre-migration', '20260901', 9), ...estranei];

    const eliminati = backupsToPrune(nomi);

    for (const estraneo of estranei) {
      assert.ok(!eliminati.includes(estraneo), `non deve toccare ${estraneo}`);
    }
    assert.equal(eliminati.length, 4);
  });

  it('un elenco vuoto non produce cancellazioni', () => {
    assert.deepEqual(backupsToPrune([]), []);
  });

  it('i tipi non si influenzano fra loro', () => {
    const nomi = [
      ...giorniConsecutivi('pre-migration', '20260901', 6),
      ...giorniConsecutivi('pre-restore', '20260901', 4),
      ...giorniConsecutivi('manual', '20260901', 4),
    ];

    const eliminati = backupsToPrune(nomi);

    assert.equal(eliminati.filter((nome) => nome.startsWith('pre-migration')).length, 1);
    assert.equal(eliminati.filter((nome) => nome.startsWith('pre-restore')).length, 1);
    assert.equal(eliminati.filter((nome) => nome.startsWith('manual')).length, 0);
  });
});
