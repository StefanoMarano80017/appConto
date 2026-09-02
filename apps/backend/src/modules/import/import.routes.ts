import { Router, json, text } from 'express';
import { config } from '../../config.js';
import { ValidationError } from '../../shared/errors.js';
import { importService } from './import.service.js';

export const importRouter = Router();

/** Il CSV arriva come testo grezzo: `Content-Type: text/csv`. */
const csvBody = text({ type: ['text/csv', 'text/plain'], limit: config.maxCsvSize });

/** Nell'import manuale il CSV viaggia dentro il JSON, quindi vale lo stesso tetto. */
const mappedBody = json({ limit: config.maxCsvSize });

function requireCsv(body: unknown): string {
  if (typeof body !== 'string') {
    throw new ValidationError(
      'Il corpo della richiesta deve contenere il CSV con Content-Type "text/csv".',
    );
  }

  return body;
}

/**
 * POST /import/csv/analysis
 *
 * Dice quali colonne contiene il file e quali sono state riconosciute, senza
 * importare nulla: è il passo che permette all'utente di correggere il
 * riconoscimento prima di scrivere in archivio.
 */
importRouter.post('/csv/analysis', csvBody, (req, res) => {
  res.json(importService.analyzeCsv(requireCsv(req.body)));
});

/**
 * POST /import/csv
 *
 * Importa con le colonne rilevate dal contenuto del file.
 */
importRouter.post('/csv', csvBody, (req, res) => {
  res.json(importService.importCsv(requireCsv(req.body)));
});

/**
 * POST /import/csv/mapped
 *
 * Importa con le colonne indicate dall'utente:
 * `{ content, mapping }` in `application/json`.
 */
importRouter.post('/csv/mapped', mappedBody, (req, res) => {
  res.json(importService.importCsvWithMapping(req.body));
});
