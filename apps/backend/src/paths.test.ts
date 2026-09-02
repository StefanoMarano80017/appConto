import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  APP_ROOT,
  FRONTEND_DIR,
  LAYOUT,
  MIGRATIONS_DIR,
  NATIVE_BINDING_FILE,
  SETTINGS_FILE,
  type PathEnvironment,
  type RuntimeSettings,
  resolveLayout,
  resolvePaths,
} from './paths.js';

/**
 * `resolvePaths` è pura, quindi le precedenze si verificano chiamandola con
 * ambienti inventati invece di avviare un processo per ogni combinazione.
 *
 * La radice finta è una directory temporanea vera: su Windows `path.resolve`
 * si comporta diversamente con radici prive di lettera di unità, e un test che
 * usasse `/fake` proverebbe qualcosa che in produzione non accade.
 */
const fakeAppRoot = mkdtempSync(path.join(tmpdir(), 'appconto-approot-'));

after(() => {
  rmSync(fakeAppRoot, { recursive: true, force: true });
});

const resolve = (env: PathEnvironment, settings: RuntimeSettings = {}) =>
  resolvePaths(fakeAppRoot, env, settings);

describe('APP_ROOT', () => {
  it('è la radice del progetto, dedotta dal codice e non dal cwd', () => {
    assert.ok(existsSync(path.join(APP_ROOT, 'package.json')));
    assert.ok(existsSync(path.join(APP_ROOT, 'apps', 'backend', 'src')));
  });

  it('è assoluta e non coincide con la directory di lavoro', () => {
    // L'indipendenza effettiva dal cwd viene provata in `runtime.test.ts`,
    // avviando il server da una directory arbitraria: qui basta constatare che
    // il valore non è relativo e non è stato dedotto dal cwd.
    assert.ok(path.isAbsolute(APP_ROOT));
    assert.notEqual(path.resolve(APP_ROOT), path.resolve(tmpdir()));
  });

  it('le migrazioni stanno sotto APP_ROOT, con il codice', () => {
    assert.equal(MIGRATIONS_DIR, path.join(APP_ROOT, 'apps', 'backend', 'drizzle'));
    assert.ok(existsSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json')));
  });

  it('la configurazione facoltativa vive sotto APP_ROOT/config', () => {
    assert.equal(SETTINGS_FILE, path.join(APP_ROOT, 'config', 'settings.json'));
  });
});

describe('DATA_ROOT predefinito', () => {
  it('senza ambiente né configurazione è APP_ROOT/data', () => {
    const { dataRoot, databaseFile } = resolve({});

    assert.equal(dataRoot, path.join(fakeAppRoot, 'data'));
    assert.equal(databaseFile, path.join(fakeAppRoot, 'data', 'database.sqlite'));
  });
});

describe('precedenza: ambiente, configurazione, default', () => {
  it("MYFINANCE_DATA vince sulla configurazione", () => {
    const { dataRoot } = resolve(
      { MYFINANCE_DATA: path.join(fakeAppRoot, 'da-ambiente') },
      { dataRoot: './da-configurazione' },
    );

    assert.equal(dataRoot, path.join(fakeAppRoot, 'da-ambiente'));
  });

  it('la configurazione vince sul default', () => {
    const { dataRoot } = resolve({}, { dataRoot: './da-configurazione' });

    assert.equal(dataRoot, path.join(fakeAppRoot, 'da-configurazione'));
  });

  it('un valore vuoto o di soli spazi non conta come scelta', () => {
    assert.equal(resolve({ MYFINANCE_DATA: '   ' }).dataRoot, path.join(fakeAppRoot, 'data'));
    assert.equal(resolve({}, { dataRoot: '' }).dataRoot, path.join(fakeAppRoot, 'data'));
  });
});

describe('percorsi relativi', () => {
  it('si risolvono rispetto ad APP_ROOT, mai al cwd', () => {
    const { dataRoot } = resolve({ MYFINANCE_DATA: './archivio' });

    assert.equal(dataRoot, path.join(fakeAppRoot, 'archivio'));
    assert.ok(
      !dataRoot.startsWith(process.cwd()) || fakeAppRoot.startsWith(process.cwd()),
      'la radice dei dati non deve derivare dalla directory di lavoro',
    );
  });

  it('accetta anche di risalire, restando ancorati ad APP_ROOT', () => {
    const { dataRoot } = resolve({ MYFINANCE_DATA: '../archivio-esterno' });

    assert.equal(dataRoot, path.resolve(fakeAppRoot, '..', 'archivio-esterno'));
  });

  it('un percorso assoluto viene rispettato tale e quale', () => {
    const assoluto = path.join(tmpdir(), 'archivio-assoluto');
    const { dataRoot } = resolve({ MYFINANCE_DATA: assoluto });

    assert.equal(dataRoot, assoluto);
  });
});

describe('DATABASE_FILE come alias di compatibilità', () => {
  it('indica il file esatto e porta con sé la radice dei dati', () => {
    // È il meccanismo su cui poggiano gli 11 file di test preesistenti: se
    // DATA_ROOT restasse quello predefinito, un test scriverebbe log e
    // temporanei dentro il repository.
    const file = path.join(tmpdir(), 'una-cartella', 'test.db');
    const { databaseFile, dataRoot, logsDir, tmpDir } = resolve({ DATABASE_FILE: file });

    assert.equal(databaseFile, file);
    assert.equal(dataRoot, path.join(tmpdir(), 'una-cartella'));
    assert.equal(logsDir, path.join(tmpdir(), 'una-cartella', 'logs'));
    assert.equal(tmpDir, path.join(tmpdir(), 'una-cartella', 'tmp'));
  });

  it('MYFINANCE_DATA governa la radice, DATABASE_FILE solo il file', () => {
    const radice = path.join(tmpdir(), 'radice-scelta');
    const file = path.join(tmpdir(), 'altrove', 'esplicito.db');
    const { dataRoot, databaseFile, logsDir } = resolve({
      MYFINANCE_DATA: radice,
      DATABASE_FILE: file,
    });

    assert.equal(dataRoot, radice);
    assert.equal(databaseFile, file);
    assert.equal(logsDir, path.join(radice, 'logs'));
  });
});

describe('struttura del DATA_ROOT', () => {
  it('database, backups, logs e tmp stanno tutti sotto la radice dei dati', () => {
    const { dataRoot, databaseFile, backupsDir, logsDir, tmpDir } = resolve({
      MYFINANCE_DATA: path.join(fakeAppRoot, 'dati'),
    });

    assert.equal(databaseFile, path.join(dataRoot, 'database.sqlite'));
    assert.equal(backupsDir, path.join(dataRoot, 'backups'));
    assert.equal(logsDir, path.join(dataRoot, 'logs'));
    assert.equal(tmpDir, path.join(dataRoot, 'tmp'));
  });

  it('il lock di istanza sta dentro la radice dei dati', () => {
    /*
     * Il vincolo di istanza unica è sull'**archivio**, non sul programma: due
     * copie del package che aprono radici diverse sono due applicazioni
     * indipendenti. Tenendo il lock dentro `DATA_ROOT`, il suo percorso è già
     * la chiave — nessun hash, nessuna normalizzazione, nessuna possibilità
     * che due forme dello stesso percorso producano due chiavi diverse.
     */
    const uno = resolve({ MYFINANCE_DATA: path.join(fakeAppRoot, 'dati') });
    const due = resolve({ MYFINANCE_DATA: path.join(fakeAppRoot, 'altri-dati') });

    assert.equal(uno.instanceLockFile, path.join(uno.dataRoot, 'instance.lock'));
    assert.notEqual(uno.instanceLockFile, due.instanceLockFile);
  });

  it('tmp non è la cartella temporanea del sistema', () => {
    // I file temporanei del backup (WP-P3) vanno rinominati sul database, e
    // `rename` è atomico solo all'interno dello stesso volume.
    const { tmpDir, dataRoot } = resolve({ MYFINANCE_DATA: path.join(fakeAppRoot, 'dati') });

    assert.ok(tmpDir.startsWith(dataRoot));
    assert.notEqual(path.resolve(tmpDir), path.resolve(tmpdir()));
  });
});

/**
 * Le due disposizioni.
 *
 * `resolveLayout` è pura: riceve la cartella in cui si troverebbe il modulo e
 * restituisce dove starebbero le cose. Così la disposizione del package si
 * verifica senza confezionarlo, e quella del repository senza fingere nulla —
 * il che rende inutile duplicare gli alberi di directory nei test.
 *
 * La prova end-to-end sul package vero, con il runtime incorporato, sta in
 * `scripts/verify-package.mjs`.
 */

/**
 * Una radice assoluta verosimile, ricavata da quella vera del sistema.
 *
 * `path.parse(...).root` dà `C:\` su Windows e `/` altrove: così i percorsi di
 * prova sono assoluti su entrambe le piattaforme senza scrivere separatori a
 * mano, che è precisamente il genere di dettaglio che rende un test verde su
 * una piattaforma e falso sull'altra.
 */
const radici = [path.join(path.parse(tmpdir()).root, 'Portable Apps')];

describe('disposizione: repository', () => {
  it('APP_ROOT sta tre livelli sopra apps/backend/src', () => {
    for (const radice of radici) {
      const esito = resolveLayout(path.join(radice, 'appConto', 'apps', 'backend', 'src'));

      assert.equal(esito.layout, 'repository');
      assert.equal(esito.appRoot, path.join(radice, 'appConto'));
    }
  });

  it('vale lo stesso per la build locale in apps/backend/dist', () => {
    for (const radice of radici) {
      const src = resolveLayout(path.join(radice, 'appConto', 'apps', 'backend', 'src'));
      const dist = resolveLayout(path.join(radice, 'appConto', 'apps', 'backend', 'dist'));

      assert.equal(dist.layout, 'repository');
      assert.equal(dist.appRoot, src.appRoot, 'sorgente e build vedono la stessa radice');
      assert.equal(dist.migrationsDir, src.migrationsDir, 'e le stesse migrazioni');
      assert.equal(dist.frontendDir, src.frontendDir, 'e lo stesso frontend');
    }
  });

  it('frontend e migrazioni stanno dove li mettono i rispettivi strumenti', () => {
    const radice = radici[0] ?? '';
    const esito = resolveLayout(path.join(radice, 'appConto', 'apps', 'backend', 'src'));

    assert.equal(
      esito.migrationsDir,
      path.join(radice, 'appConto', 'apps', 'backend', 'drizzle'),
    );
    assert.equal(
      esito.frontendDir,
      path.join(radice, 'appConto', 'apps', 'frontend', 'dist', 'frontend', 'browser'),
    );
  });
});

describe('disposizione: package portatile', () => {
  it('APP_ROOT sta due livelli sopra app/backend', () => {
    for (const radice of radici) {
      const esito = resolveLayout(path.join(radice, 'MyFinance', 'app', 'backend'));

      assert.equal(esito.layout, 'package');
      assert.equal(esito.appRoot, path.join(radice, 'MyFinance'));
    }
  });

  it('tutto ciò che è codice sta sotto app/, e nulla di più', () => {
    const radice = radici[0] ?? '';
    const pkg = path.join(radice, 'MyFinance');
    const esito = resolveLayout(path.join(pkg, 'app', 'backend'));

    assert.equal(esito.migrationsDir, path.join(pkg, 'app', 'drizzle'));
    assert.equal(esito.frontendDir, path.join(pkg, 'app', 'frontend'));
    assert.equal(
      esito.nativeBindingCandidate,
      path.join(pkg, 'app', 'backend', 'native', 'better_sqlite3.node'),
    );

    // Il principio del WP: sostituire `app/` non tocca `config/` né `data/`.
    for (const percorso of [esito.migrationsDir, esito.frontendDir, esito.nativeBindingCandidate]) {
      assert.ok(
        percorso.startsWith(path.join(pkg, 'app') + path.sep),
        `${percorso} deve stare sotto app/`,
      );
    }
  });

  it('i dati e la configurazione restano fuori da app/', () => {
    const radice = radici[0] ?? '';
    const pkg = path.join(radice, 'MyFinance');
    const esito = resolveLayout(path.join(pkg, 'app', 'backend'));

    const percorsi = resolvePaths(esito.appRoot, {}, {});

    assert.equal(percorsi.dataRoot, path.join(pkg, 'data'));
    for (const percorso of [
      percorsi.databaseFile,
      percorsi.backupsDir,
      percorsi.logsDir,
      percorsi.tmpDir,
      percorsi.instanceLockFile,
    ]) {
      assert.ok(
        !percorso.startsWith(path.join(pkg, 'app') + path.sep),
        `${percorso} non deve stare sotto app/`,
      );
      assert.ok(!percorso.startsWith(path.join(pkg, 'runtime') + path.sep));
    }
  });

  it('una cartella che si chiama "apps" non viene confusa con "app"', () => {
    // `apps/backend` è il repository, `app/backend` è il package: un carattere
    // di differenza, e due risalite diverse.
    const radice = radici[0] ?? '';
    assert.equal(resolveLayout(path.join(radice, 'x', 'apps', 'backend')).layout, 'repository');
    assert.equal(resolveLayout(path.join(radice, 'x', 'app', 'backend')).layout, 'package');
  });

  it('la disposizione dipende dai due segmenti finali, non dal resto del percorso', () => {
    const dentroUnRepo = resolveLayout(
      path.join(radici[0] ?? '', 'appConto', 'dist-package', 'MyFinance', 'app', 'backend'),
    );

    assert.equal(dentroUnRepo.layout, 'package');
    assert.equal(
      dentroUnRepo.appRoot,
      path.join(radici[0] ?? '', 'appConto', 'dist-package', 'MyFinance'),
      'un package confezionato dentro il repository punta a sé stesso',
    );
  });

  it('nomi con spazi e accenti non cambiano nulla', () => {
    const radice = path.join(radici[0] ?? '', 'Le mie Applicazioni Portàtili');
    const esito = resolveLayout(path.join(radice, 'My Finance', 'app', 'backend'));

    assert.equal(esito.layout, 'package');
    assert.equal(esito.appRoot, path.join(radice, 'My Finance'));
    assert.equal(esito.frontendDir, path.join(radice, 'My Finance', 'app', 'frontend'));
  });
});

describe('disposizione effettiva di questa esecuzione', () => {
  it('i test girano dal repository, e i valori esposti lo riflettono', () => {
    assert.equal(LAYOUT, 'repository');
    assert.equal(MIGRATIONS_DIR, path.join(APP_ROOT, 'apps', 'backend', 'drizzle'));
    assert.equal(
      FRONTEND_DIR,
      path.join(APP_ROOT, 'apps', 'frontend', 'dist', 'frontend', 'browser'),
    );
  });

  it('in sviluppo il binario nativo lo risolve better-sqlite3, non noi', () => {
    // I test girano dai sorgenti, dove `native/` non esiste: il valore deve
    // essere `null`, cioè "non imporre nessun percorso". Nel package esiste, e
    // `verify-package.mjs` verifica che venga davvero usato.
    assert.equal(NATIVE_BINDING_FILE, null);
  });
});
