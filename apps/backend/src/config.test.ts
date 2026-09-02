import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che risolvono i
// percorsi: `config` li calcola una volta sola, al momento dell'import.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-config-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'config-test.db');

const { config, resolveAutoBackupHours } = await import('./config.js');

/**
 * La cadenza dei backup automatici.
 *
 * `resolveAutoBackupHours` è pura perché le precedenze — ambiente, poi
 * configurazione, poi il valore predefinito — vanno verificate senza avviare
 * un processo per ogni combinazione, come già si fa per la radice dei dati.
 */

describe('cadenza dei backup automatici', () => {
  it('senza indicazioni è giornaliera', () => {
    /*
     * Ventiquattro ore non è un numero scelto adesso: la ritenzione del tipo
     * `auto` definita da WP-P3 conserva il più recente di ciascuno degli
     * ultimi sette giorni. Un secondo backup nello stesso giorno finirebbe
     * nello stesso slot, cioè sarebbe lavoro buttato.
     */
    assert.equal(resolveAutoBackupHours(undefined, undefined), 24);
  });

  it("l'ambiente ha la precedenza sulla configurazione", () => {
    assert.equal(resolveAutoBackupHours('6', 12), 6);
  });

  it('la configurazione vale se l-ambiente non dice niente', () => {
    assert.equal(resolveAutoBackupHours(undefined, 12), 12);
  });

  it('zero è una risposta, non un valore mancante', () => {
    // Disattiva i backup automatici. Va distinto da "non indicato", che
    // significa invece "usa il valore predefinito".
    assert.equal(resolveAutoBackupHours('0', undefined), 0);
    assert.equal(resolveAutoBackupHours(undefined, 0), 0);
  });

  it('un valore frazionario è ammesso', () => {
    // Serve ai test, che non possono attendere un giorno.
    assert.equal(resolveAutoBackupHours('0.001', undefined), 0.001);
  });

  it('un valore insensato non spegne la funzione: si torna al predefinito', () => {
    for (const scritto of ['', 'ogni tanto', '-3', 'NaN']) {
      assert.equal(
        resolveAutoBackupHours(scritto, undefined),
        24,
        `"${scritto}" doveva essere ignorato`,
      );
    }
    assert.equal(resolveAutoBackupHours(undefined, -1), 24);
  });

  it('la configurazione la espone in millisecondi', () => {
    // Il resto dell'applicazione lavora in millisecondi: la conversione
    // avviene una volta, qui.
    assert.equal(typeof config.autoBackupIntervalMs, 'number');
    assert.ok(config.autoBackupIntervalMs >= 0);
    assert.equal(config.autoBackupIntervalMs % 1, 0);
  });
});

describe('isolamento del test', () => {
  it('il processo punta a un database temporaneo', () => {
    assert.ok(config.databaseFile.startsWith(tmpdir()));
    assert.ok(config.dataRoot.startsWith(tmpdir()));
    // Il lock di istanza segue la radice dati, quindi anche lui è temporaneo.
    assert.ok(config.instanceLockFile.startsWith(tmpdir()));
  });
});
