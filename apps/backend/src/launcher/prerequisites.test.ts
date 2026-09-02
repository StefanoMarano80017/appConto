import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { missingPrerequisites, serverEntry, type PackageLayout } from './prerequisites.js';

/**
 * La copia è completa?
 *
 * Nessun file viene creato: `exists` è iniettabile, e la politica — quali
 * pezzi sono indispensabili — si prova descrivendo cosa c'è invece di
 * costruire quattro alberi di directory.
 */

const layout: PackageLayout = {
  backendDir: path.join('C:', 'MyFinance', 'app', 'backend'),
  frontendDir: path.join('C:', 'MyFinance', 'app', 'frontend'),
  migrationsDir: path.join('C:', 'MyFinance', 'app', 'drizzle'),
};

const tutti = [
  path.join(layout.backendDir, 'server.js'),
  path.join(layout.backendDir, 'native', 'better_sqlite3.node'),
  path.join(layout.frontendDir, 'index.html'),
  path.join(layout.migrationsDir, 'meta', '_journal.json'),
];

/** Esiste tutto tranne ciò che si dichiara assente. */
const tranne = (assenti: string[]) => (file: string) => !assenti.includes(file);

describe('prerequisiti del package', () => {
  it('con la copia completa non manca niente', () => {
    assert.deepEqual(missingPrerequisites(layout, tranne([])), []);
  });

  it('segnala ogni pezzo mancante con il percorso e a cosa serve', () => {
    for (const file of tutti) {
      const mancanti = missingPrerequisites(layout, tranne([file]));

      assert.equal(mancanti.length, 1, `doveva mancare solo ${file}`);
      assert.equal(mancanti[0]?.file, file);
      assert.ok(
        (mancanti[0]?.what.length ?? 0) > 0,
        'il messaggio deve dire a cosa serve il file, non solo il nome',
      );
    }
  });

  it('elenca tutti i pezzi mancanti, non si ferma al primo', () => {
    // Un antivirus che mette in quarantena più file, o uno zip estratto a
    // metà: dire "manca questo" e scoprire il resto al tentativo successivo
    // costringerebbe l'utente a tre avvii.
    const mancanti = missingPrerequisites(layout, tranne(tutti));

    assert.equal(mancanti.length, 4);
    assert.deepEqual(
      mancanti.map((pezzo) => pezzo.file).sort(),
      [...tutti].sort(),
    );
  });

  it('il binario nativo è un prerequisito quanto il programma', () => {
    // Nel package `node_modules` non esiste: senza quel file il server
    // morirebbe su un `require` fallito, con una traccia di stack che non
    // dice niente a chi usa l-applicazione.
    const mancanti = missingPrerequisites(
      layout,
      tranne([path.join(layout.backendDir, 'native', 'better_sqlite3.node')]),
    );

    assert.equal(mancanti.length, 1);
    assert.match(mancanti[0]?.what ?? '', /database/);
  });
});

describe('il programma da avviare', () => {
  it('sta accanto al launcher', () => {
    assert.equal(serverEntry(layout.backendDir), path.join(layout.backendDir, 'server.js'));
  });
});
