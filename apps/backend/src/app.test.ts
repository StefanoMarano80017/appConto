import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

// Il database di prova va scelto prima di caricare i moduli che aprono la connessione.
const databaseDir = mkdtempSync(path.join(tmpdir(), 'appconto-app-'));
process.env.DATABASE_FILE = path.join(databaseDir, 'test.db');

const { createApp } = await import('./app.js');
const { config } = await import('./config.js');
const { runMigrations } = await import('./db/client.js');

runMigrations();

/**
 * Una build del frontend inventata.
 *
 * Al test serve sapere *cosa* viene servito, non cosa contiene: dipendere dalla
 * build reale renderebbe l'esito legato all'aver eseguito `ng build`.
 */
const frontendDir = mkdtempSync(path.join(tmpdir(), 'appconto-frontend-'));
const INDEX_HTML = '<!doctype html><title>finta</title><app-root></app-root>';
const BUNDLE_JS = 'globalThis.finto = true;';
writeFileSync(path.join(frontendDir, 'index.html'), INDEX_HTML);
writeFileSync(path.join(frontendDir, 'main-TEST.js'), BUNDLE_JS);

const server = createApp(frontendDir).listen(0, config.host);
await new Promise<void>((resolve) => server.once('listening', resolve));

const address = server.address() as AddressInfo;

after(() => {
  server.close();
  for (const directory of [databaseDir, frontendDir]) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // su Windows il file può restare bloccato: è comunque una cartella temporanea
    }
  }
});

interface Reply {
  status: number;
  body: string;
  contentType: string;
}

/**
 * Una richiesta HTTP grezza.
 *
 * Non `fetch`: `Host` è un "forbidden header name" e viene scartato in
 * silenzio, quindi l'allowlist non sarebbe verificabile.
 */
function send(
  pathname: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: config.host,
        port: address.port,
        path: pathname,
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body,
            contentType: response.headers['content-type'] ?? '',
          });
        });
      },
    );

    outgoing.on('error', reject);
    if (options.body !== undefined) {
      outgoing.write(options.body);
    }
    outgoing.end();
  });
}

describe('bind del server', () => {
  it('ascolta esclusivamente su loopback', () => {
    assert.equal(config.host, '127.0.0.1');
    assert.equal(address.address, '127.0.0.1');
  });
});

describe('allowlist degli host', () => {
  it('accetta gli indirizzi della macchina stessa, con e senza porta', async () => {
    for (const host of [
      `127.0.0.1:${address.port}`,
      `localhost:${address.port}`,
      'localhost',
      '127.0.0.1',
    ]) {
      const reply = await send('/api/health', { headers: { Host: host } });

      assert.equal(reply.status, 200, `Host "${host}" avrebbe dovuto essere accettato`);
    }
  });

  it('rifiuta un host estraneo, anche se la connessione arriva da loopback', async () => {
    const reply = await send('/api/health', { headers: { Host: 'evil.example' } });

    assert.equal(reply.status, 403);
    assert.match(reply.body, /Host non consentito/);
  });

  it('rifiuta un dominio che risolve a 127.0.0.1', async () => {
    // Il DNS rebinding arriva qui: connessione locale, nome altrui.
    const reply = await send('/api/health', { headers: { Host: 'rebind.evil.example:3000' } });

    assert.equal(reply.status, 403);
  });
});

describe('richieste mutative', () => {
  const mutation = (headers: Record<string, string>): Promise<Reply> =>
    send('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ initialBalance: 100 }),
    });

  it('accetta una richiesta dichiarata same-origin dal browser', async () => {
    const reply = await mutation({ 'Sec-Fetch-Site': 'same-origin' });

    assert.equal(reply.status, 200);
  });

  it('accetta il dev server Angular, che raggiunge le API attraverso il proxy', async () => {
    const reply = await mutation({
      Origin: 'http://localhost:4200',
      'Sec-Fetch-Site': 'same-origin',
    });

    assert.equal(reply.status, 200);
  });

  it('rifiuta una richiesta che il browser dichiara cross-site', async () => {
    const reply = await mutation({ 'Sec-Fetch-Site': 'cross-site' });

    assert.equal(reply.status, 403);
    assert.match(reply.body, /contesto esterno/);
  });

  it('rifiuta un\'origine estranea anche senza Sec-Fetch-Site', async () => {
    const reply = await mutation({ Origin: 'https://evil.example' });

    assert.equal(reply.status, 403);
    assert.match(reply.body, /Origine non consentita/);
  });

  it('lascia passare una richiesta senza intestazioni di provenienza', async () => {
    // `curl` e gli script non sono la minaccia da cui il controllo difende.
    const reply = await mutation({});

    assert.equal(reply.status, 200);
  });

  it('non applica il controllo alle letture', async () => {
    // Senza intestazioni CORS il browser non consegna il corpo a chi ha
    // chiamato: non c'è nulla da proteggere che non sia già protetto.
    const reply = await send('/api/transactions', { headers: { Origin: 'https://evil.example' } });

    assert.equal(reply.status, 200);
  });
});

describe('API sotto /api', () => {
  it('espone lo stato del servizio', async () => {
    const reply = await send('/api/health');

    assert.equal(reply.status, 200);
    assert.deepEqual(JSON.parse(reply.body), { status: 'ok' });
  });

  it('risponde con i dati, non con l\'interfaccia', async () => {
    for (const pathname of ['/api/transactions', '/api/categories', '/api/loans']) {
      const reply = await send(pathname);

      assert.equal(reply.status, 200, pathname);
      assert.match(reply.contentType, /application\/json/, pathname);
      assert.notEqual(reply.body, INDEX_HTML, pathname);
    }
  });

  it('una rotta API inesistente è un errore, non una rotta dell\'interfaccia', async () => {
    const reply = await send('/api/non-existing-route');

    assert.equal(reply.status, 404);
    assert.match(reply.contentType, /application\/json/);
    assert.notEqual(reply.body, INDEX_HTML);
  });

  it('nemmeno /api da solo ricade nel fallback', async () => {
    const reply = await send('/api');

    assert.equal(reply.status, 404);
    assert.notEqual(reply.body, INDEX_HTML);
  });
});

describe('frontend e rotte Angular', () => {
  it('serve l\'applicazione sulla radice', async () => {
    const reply = await send('/');

    assert.equal(reply.status, 200);
    assert.equal(reply.body, INDEX_HTML);
  });

  it('serve l\'applicazione sulle rotte del router, anche profonde', async () => {
    for (const pathname of [
      '/analytics',
      '/transactions',
      '/loans',
      '/loans/9f1c-abc',
      '/settings',
      '/transactions?search=esselunga&page=2',
    ]) {
      const reply = await send(pathname);

      assert.equal(reply.status, 200, pathname);
      assert.equal(reply.body, INDEX_HTML, pathname);
    }
  });

  it('serve i file della build senza sostituirli con index.html', async () => {
    const reply = await send('/main-TEST.js');

    assert.equal(reply.status, 200);
    assert.equal(reply.body, BUNDLE_JS);
  });

  it('un metodo non di lettura su un percorso non-API non esiste', async () => {
    const reply = await send('/qualcosa', {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    });

    assert.equal(reply.status, 404);
    assert.notEqual(reply.body, INDEX_HTML);
  });
});

describe('frontend non compilato', () => {
  it('lo dice invece di fallire su un file mancante', async () => {
    const vuota = mkdtempSync(path.join(tmpdir(), 'appconto-frontend-vuoto-'));
    const altro = createApp(vuota).listen(0, config.host);
    await new Promise<void>((resolve) => altro.once('listening', resolve));
    const porta = (altro.address() as AddressInfo).port;

    const reply = await new Promise<Reply>((resolve, reject) => {
      const outgoing = httpRequest(
        { host: config.host, port: porta, path: '/analytics', method: 'GET' },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            body += chunk;
          });
          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              body,
              contentType: response.headers['content-type'] ?? '',
            });
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });

    altro.close();
    rmSync(vuota, { recursive: true, force: true });

    assert.equal(reply.status, 503);
    assert.match(reply.body, /Frontend non compilato/);
  });
});
