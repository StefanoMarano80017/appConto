import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

/**
 * Le API di backup e ripristino.
 *
 * Due cose contano qui e non altrove: che nessun percorso del filesystem
 * attraversi il confine — né come richiesta, né come risposta — e che
 * `POST /restore` prepari senza sostituire.
 *
 * ## Isolamento
 *
 * Radice dati temporanea scelta prima degli import, e porta assegnata dal
 * sistema con `listen(0)`: nessuna richiesta di questo file può raggiungere un
 * processo che non sia quello avviato qui.
 */

const dataRoot = mkdtempSync(path.join(tmpdir(), 'appconto-api-'));
const databaseFile = path.join(dataRoot, 'database.sqlite');
process.env.DATABASE_FILE = databaseFile;

const { createApp } = await import('../../app.js');
const { config } = await import('../../config.js');
const { closeDatabase, runMigrations } = await import('../../db/client.js');
const { importService } = await import('../import/index.js');
const { restoreService } = await import('./restore.service.js');
const { backupService } = await import('./backup.service.js');
const { CANDIDATE_FILE, PENDING_RESTORE_FILE } = await import('./restore-pending.js');

runMigrations();
importService.importCsv(
  [
    'Data contabile,Descrizione,Importo',
    '01/05/2026,SPESA DI PROVA,-12.50',
    '02/05/2026,ALTRA SPESA,-34.00',
  ].join('\r\n'),
);

const frontendDir = mkdtempSync(path.join(tmpdir(), 'appconto-api-fe-'));
const server = createApp(frontendDir).listen(0, config.host);
await new Promise<void>((resolve) => {
  server.once('listening', resolve);
});
const address = server.address() as AddressInfo;

after(() => {
  server.close();
  closeDatabase();
  for (const cartella of [dataRoot, frontendDir]) {
    try {
      rmSync(cartella, { recursive: true, force: true });
    } catch {
      // su Windows il file può restare bloccato: sono cartelle temporanee
    }
  }
});

interface Risposta {
  status: number;
  body: string;
  raw: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

/** Una richiesta HTTP grezza, con il corpo raccolto in binario. */
function invia(
  pathname: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Risposta> {
  return new Promise((resolve, reject) => {
    const uscente = httpRequest(
      {
        host: config.host,
        port: address.port,
        path: pathname,
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
      },
      (risposta) => {
        const pezzi: Buffer[] = [];
        risposta.on('data', (pezzo: Buffer) => pezzi.push(pezzo));
        risposta.on('end', () => {
          const raw = Buffer.concat(pezzi);
          resolve({
            status: risposta.statusCode ?? 0,
            body: raw.toString('utf8'),
            raw,
            headers: risposta.headers,
          });
        });
      },
    );

    uscente.on('error', reject);
    if (options.body !== undefined) {
      uscente.write(options.body);
    }
    uscente.end();
  });
}

const inviaJson = (
  pathname: string,
  method: string,
  corpo: unknown,
): Promise<Risposta> =>
  invia(pathname, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });

const marker = path.join(dataRoot, PENDING_RESTORE_FILE);

function svuotaBackup(): void {
  rmSync(marker, { force: true });
  rmSync(path.join(config.tmpDir, CANDIDATE_FILE), { force: true });
  for (const nome of readdirSync(config.backupsDir)) {
    rmSync(path.join(config.backupsDir, nome), { force: true });
  }
}

describe('isolamento del test', () => {
  it('porta assegnata dal sistema e database temporaneo', () => {
    assert.notEqual(address.port, 3000, 'mai la porta di sviluppo');
    assert.ok(address.port > 0);
    assert.equal(config.databaseFile, databaseFile);
    assert.ok(config.databaseFile.startsWith(tmpdir()));
  });
});

describe('GET /api/backups', () => {
  beforeEach(svuotaBackup);

  it('senza backup risponde con un elenco vuoto e nessun ripristino in attesa', async () => {
    const risposta = await invia('/api/backups');

    assert.equal(risposta.status, 200);
    assert.deepEqual(JSON.parse(risposta.body), { backups: [], pendingRestore: null });
  });

  it('elenca i backup senza rivelare un solo percorso', async () => {
    backupService.create('manual', new Date(2026, 8, 5, 10, 0, 0));

    const risposta = await invia('/api/backups');
    const corpo = JSON.parse(risposta.body) as {
      backups: { name: string; kind: string; rowCounts: Record<string, number> }[];
    };

    assert.equal(risposta.status, 200);
    assert.equal(corpo.backups.length, 1);
    assert.equal(corpo.backups[0]?.name, 'manual-20260905-100000.sqlite');
    assert.equal(corpo.backups[0]?.kind, 'manual');
    assert.equal(corpo.backups[0]?.rowCounts.transactions, 2);

    // Nessun percorso assoluto, in nessuna forma.
    assert.ok(!risposta.body.includes(dataRoot));
    assert.ok(!risposta.body.includes(tmpdir()));
    assert.ok(!/[A-Za-z]:\\\\|\/home\/|\/Users\//.test(risposta.body));
  });
});

describe('POST /api/backups', () => {
  beforeEach(svuotaBackup);

  it('crea un backup manuale e lo restituisce', async () => {
    const risposta = await invia('/api/backups', { method: 'POST' });
    const corpo = JSON.parse(risposta.body) as { name: string; kind: string; status: string };

    assert.equal(risposta.status, 201);
    assert.equal(corpo.kind, 'manual');
    assert.equal(corpo.status, 'completo');
    assert.ok(existsSync(path.join(config.backupsDir, corpo.name)));

    const elenco = JSON.parse((await invia('/api/backups')).body) as { backups: unknown[] };
    assert.equal(elenco.backups.length, 1);
  });

  it("una richiesta da un'altra origine viene respinta", async () => {
    const risposta = await invia('/api/backups', {
      method: 'POST',
      headers: { Origin: 'http://evil.example' },
    });

    assert.equal(risposta.status, 403);
    assert.deepEqual(readdirSync(config.backupsDir), [], 'nessun backup creato');
  });
});

describe('GET /api/backups/:name', () => {
  beforeEach(svuotaBackup);

  it('scarica il file, identico a quello su disco', async () => {
    const info = backupService.create('manual', new Date(2026, 8, 5, 11, 0, 0));

    const risposta = await invia(`/api/backups/${info.name}`);

    assert.equal(risposta.status, 200);
    assert.deepEqual(risposta.raw, readFileSync(path.join(config.backupsDir, info.name)));
    assert.match(String(risposta.headers['content-disposition']), /attachment/);
    assert.match(String(risposta.headers['content-disposition']), /manual-20260905-110000\.sqlite/);
  });

  it('un backup che non esiste non si scarica', async () => {
    const risposta = await invia('/api/backups/manual-19990101-000000.sqlite');

    assert.equal(risposta.status, 400);
    assert.match(risposta.body, /non esiste/);
  });

  it('nessun nome riesce a far servire un file fuori da backups/', async () => {
    // Le forme percentuali sono quelle che arrivano davvero al parametro: il
    // path grezzo con `../` viene normalizzato o non corrisponde alla rotta.
    const tentativi = [
      '/api/backups/%2e%2e%2f%2e%2e%2fdatabase.sqlite',
      '/api/backups/..%2Fdatabase.sqlite',
      '/api/backups/..%2F..%2Fpackage.json',
      '/api/backups/%2Fetc%2Fpasswd',
      '/api/backups/database.sqlite',
      '/api/backups/C%3A%5CWindows%5Csystem.ini',
      '/api/backups/%2e%2e%5Cdatabase.sqlite',
    ];

    for (const tentativo of tentativi) {
      const risposta = await invia(tentativo);

      assert.equal(risposta.status, 400, `${tentativo} ha risposto ${String(risposta.status)}`);
      assert.match(risposta.body, /non valido|non è il nome di un backup/);
      // Nessun byte di database è uscito: i file SQLite iniziano così.
      assert.ok(!risposta.body.startsWith('SQLite format 3'));
    }
  });

  it('anche un percorso grezzo con ../ non serve il database', async () => {
    for (const tentativo of [
      '/api/backups/../../database.sqlite',
      '/api/backups/../../../package.json',
    ]) {
      const risposta = await invia(tentativo);

      assert.notEqual(risposta.status, 200, `${tentativo} non deve riuscire`);
      assert.ok(!risposta.body.startsWith('SQLite format 3'));
      assert.ok(!risposta.body.includes('"better-sqlite3"'), 'nemmeno il package.json');
    }
  });
});

describe('POST /api/restore', () => {
  beforeEach(svuotaBackup);

  it('prepara il ripristino e non sostituisce niente', async () => {
    const info = backupService.create('manual', new Date(2026, 8, 5, 12, 0, 0));
    const primaDelRestore = readFileSync(databaseFile);

    const risposta = await inviaJson('/api/restore', 'POST', { name: info.name });
    const corpo = JSON.parse(risposta.body) as {
      backupName: string;
      preRestoreBackup: string;
      restartRequired: boolean;
      message: string;
    };

    assert.equal(risposta.status, 202, 'accettata, non eseguita');
    assert.equal(corpo.backupName, info.name);
    assert.equal(corpo.restartRequired, true);
    assert.match(corpo.message, /Riavvia/);

    // L'archivio attivo è ancora identico, byte per byte.
    assert.deepEqual(readFileSync(databaseFile), primaDelRestore);
    assert.ok(existsSync(marker), 'il ripristino risulta in attesa');
    assert.ok(!risposta.body.includes(dataRoot), 'nessun percorso nella risposta');
  });

  it('lo stato in attesa si legge, e si annulla', async () => {
    const info = backupService.create('manual', new Date(2026, 8, 5, 13, 0, 0));
    await inviaJson('/api/restore', 'POST', { name: info.name });

    const stato = JSON.parse((await invia('/api/restore')).body) as {
      backupName: string;
      restartRequired: boolean;
    };
    assert.equal(stato.backupName, info.name);
    assert.equal(stato.restartRequired, true);

    // Compare anche nella vista d'insieme, così l'interfaccia può dirlo.
    const elenco = JSON.parse((await invia('/api/backups')).body) as {
      pendingRestore: { backupName: string } | null;
    };
    assert.equal(elenco.pendingRestore?.backupName, info.name);

    const annullato = await invia('/api/restore', { method: 'DELETE' });
    assert.equal(annullato.status, 200);
    assert.equal(JSON.parse((await invia('/api/restore')).body), null);
    assert.ok(!existsSync(marker));
  });

  it('annullare quando non c-è niente in attesa risponde 404', async () => {
    const risposta = await invia('/api/restore', { method: 'DELETE' });

    assert.equal(risposta.status, 404);
    assert.deepEqual(JSON.parse(risposta.body), { cancelled: false });
  });

  it('un nome mancante o non valido è una richiesta malformata', async () => {
    for (const corpo of [{}, { name: '' }, { name: 42 }, { nome: 'x' }]) {
      const risposta = await inviaJson('/api/restore', 'POST', corpo);

      assert.equal(risposta.status, 400, `${JSON.stringify(corpo)} ha risposto ${String(risposta.status)}`);
      assert.ok(!existsSync(marker));
    }
  });

  it('un nome che tenta di uscire dalla cartella è rifiutato', async () => {
    for (const nome of [
      '../database.sqlite',
      '../../data/database.sqlite',
      '/etc/passwd',
      'C:\\Windows\\System32\\config\\SAM',
      '%2e%2e%2fdatabase.sqlite',
      'database.sqlite',
    ]) {
      const risposta = await inviaJson('/api/restore', 'POST', { name: nome });

      assert.equal(risposta.status, 400, `${nome} ha risposto ${String(risposta.status)}`);
      assert.match(risposta.body, /non è il nome di un backup/);
      assert.ok(!existsSync(marker), `${nome} non deve preparare niente`);
    }
  });

  it("una richiesta da un'altra origine viene respinta prima di arrivare al servizio", async () => {
    const info = backupService.create('manual', new Date(2026, 8, 5, 14, 0, 0));

    const risposta = await invia('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
      body: JSON.stringify({ name: info.name }),
    });

    assert.equal(risposta.status, 403);
    assert.ok(!existsSync(marker));
    assert.equal(restoreService.pending(), null);
  });
});

describe('rotte inesistenti sotto /api', () => {
  it('non finiscono nel frontend', async () => {
    for (const pathname of ['/api/backup', '/api/restores', '/api/backups/x/y']) {
      const risposta = await invia(pathname);

      assert.equal(risposta.status, 404);
      assert.match(risposta.body, /Risorsa non trovata/);
    }
  });
});
