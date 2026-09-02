import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type RequestHandler } from 'express';

/**
 * Il frontend servito da Express.
 *
 * In produzione interfaccia e API vivono sulla stessa origine: non c'è un dev
 * server, e i file prodotti da `ng build` li serve il backend. È questa scelta
 * a rendere superfluo CORS e a permettere il controllo di provenienza in
 * `local-only.ts`.
 */

/** I file della build: il bundle, gli stili, la favicon. */
export function staticAssets(frontendDir: string): RequestHandler {
  // `index: false` perché `index.html` ha un solo punto di uscita: il fallback
  // qui sotto. Con due, `/` e `/analytics` potrebbero divergere.
  return express.static(frontendDir, { index: false });
}

/**
 * Le rotte del router Angular.
 *
 * `/loans/123` non è un file: è uno stato dell'interfaccia, e il browser deve
 * ricevere l'applicazione perché sia lei a interpretarlo.
 *
 * Va montato **dopo** le API e dopo i file statici: qui arriva soltanto ciò che
 * non è né l'una né gli altri. Senza quest'ordine `/api/transactions`
 * riceverebbe `index.html` al posto dei dati.
 */
export function spaFallback(frontendDir: string): RequestHandler {
  const indexHtml = path.join(frontendDir, 'index.html');

  return (_req, res, next) => {
    if (!existsSync(indexHtml)) {
      // In sviluppo l'interfaccia la serve `ng serve` e qui non c'è nulla da
      // restituire: dirlo è più utile di un errore di file mancante.
      res.status(503).json({
        error: 'Frontend non compilato. Esegui "npm run build:frontend".',
      });
      return;
    }

    res.sendFile(indexHtml, (error) => {
      if (error) {
        next(error);
      }
    });
  };
}
