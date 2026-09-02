import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  BACKUP_KINDS,
  backupName,
  localTimestampOf,
  manifestNameFor,
  parseBackupName,
  resolveBackupFile,
} from './backup.naming.js';

/**
 * Nomi e percorsi dei backup.
 *
 * Il valore di questo file sta nella seconda metà: il nome di un backup è
 * l'unico dato che un client fornisce per indicare un file su disco, quindi è
 * l'unica superficie da cui potrebbe uscire dalla cartella consentita. Qui non
 * serve nessun filesystem — è tutta aritmetica di stringhe — e proprio per
 * questo si può provare per esteso.
 */

const backupsDir = path.join('C:', 'dati', 'backups');
const unixBackupsDir = '/dati/backups';

describe('nome di un backup', () => {
  it('mette la data in testa, così l-ordine alfabetico è quello cronologico', () => {
    const primo = backupName('manual', new Date(2026, 8, 1, 14, 30, 12));
    const secondo = backupName('manual', new Date(2026, 8, 1, 14, 30, 13));
    const domani = backupName('manual', new Date(2026, 8, 2, 0, 0, 0));

    assert.equal(primo, 'manual-20260901-143012.sqlite');
    assert.ok(primo < secondo);
    assert.ok(secondo < domani);
  });

  it('usa due cifre anche per i valori piccoli', () => {
    assert.equal(
      backupName('auto', new Date(2026, 0, 5, 3, 4, 5)),
      'auto-20260105-030405.sqlite',
    );
  });

  it('ogni tipo previsto produce un nome che si sa rileggere', () => {
    for (const kind of BACKUP_KINDS) {
      const nome = backupName(kind, new Date(2026, 8, 1, 14, 30, 12));
      assert.deepEqual(parseBackupName(nome), { kind, day: '20260901', time: '143012' });
    }
  });

  it('il manifest ha lo stesso nome con estensione diversa', () => {
    assert.equal(manifestNameFor('pre-restore-20260901-143012.sqlite'), 'pre-restore-20260901-143012.json');
  });

  it('dal nome si ricava l-ora locale leggibile', () => {
    const parsed = parseBackupName('auto-20260901-143012.sqlite');
    assert.ok(parsed !== null);
    assert.equal(localTimestampOf(parsed), '2026-09-01 14:30:12');
  });
});

describe('nomi che non sono nomi di backup', () => {
  const rifiutati = [
    '',
    'database.sqlite',
    'manual-20260901-143012.db',
    'manual-20260901.sqlite',
    'manual-2026901-143012.sqlite',
    'sconosciuto-20260901-143012.sqlite',
    'manual-20260901-143012.sqlite.partial',
    'manual-20260901-143012.sqlite ',
    'MANUAL-20260901-143012.sqlite',
    'manual-20260901-1430121.sqlite',
  ];

  for (const nome of rifiutati) {
    it(`rifiuta "${nome}"`, () => {
      assert.equal(parseBackupName(nome), null);
      assert.equal(resolveBackupFile(backupsDir, nome), null);
    });
  }
});

describe('nessuna uscita dalla cartella dei backup', () => {
  const traversal = [
    '../database.sqlite',
    '../../database.sqlite',
    '../../../data/database.sqlite',
    '..\database.sqlite',
    '..\..\data\database.sqlite',
    'sub/manual-20260901-143012.sqlite',
    'sub\manual-20260901-143012.sqlite',
    './manual-20260901-143012.sqlite',
    '../backups/manual-20260901-143012.sqlite',
    '%2e%2e%2fdatabase.sqlite',
    '%2E%2E%5Cdatabase.sqlite',
    '..%2fmanual-20260901-143012.sqlite',
    'manual-20260901-143012.sqlite/../../database.sqlite',
    'C:\Windows\System32\config\SAM',
    'C:/Users/stefa/Desktop/appConto/data/database.sqlite',
    '/etc/passwd',
    '\\server\share\database.sqlite',
    'manual-20260901-143012.sqlite\u0000.txt',
  ];

  for (const nome of traversal) {
    it(`non produce un percorso per "${nome}"`, () => {
      assert.equal(resolveBackupFile(backupsDir, nome), null);
      assert.equal(resolveBackupFile(unixBackupsDir, nome), null);
    });
  }

  it('un nome valido produce il percorso dentro la cartella, e nient-altro', () => {
    const risolto = resolveBackupFile(backupsDir, 'manual-20260901-143012.sqlite');

    assert.equal(risolto, path.join(backupsDir, 'manual-20260901-143012.sqlite'));
    assert.equal(path.dirname(risolto ?? ''), path.resolve(backupsDir));
  });

  it('il percorso risolto non risale mai di un livello', () => {
    // Anche variando la cartella di partenza, ciò che esce resta sotto di essa.
    for (const cartella of [backupsDir, unixBackupsDir, 'backups', './backups']) {
      const risolto = resolveBackupFile(cartella, 'auto-20260901-000000.sqlite');
      assert.ok(risolto !== null);
      assert.ok(risolto.startsWith(path.resolve(cartella) + path.sep));
    }
  });
});
