import { Router, text } from 'express';
import { config } from '../../config.js';
import { ValidationError } from '../../shared/errors.js';
import { importService } from './import.service.js';

export const importRouter = Router();

/**
 * POST /import/csv
 *
 * Il corpo della richiesta è il contenuto testuale del CSV
 * (`Content-Type: text/csv`).
 */
importRouter.post('/csv', text({ type: ['text/csv', 'text/plain'], limit: config.maxCsvSize }), (req, res) => {
  if (typeof req.body !== 'string') {
    throw new ValidationError(
      'Il corpo della richiesta deve contenere il CSV con Content-Type "text/csv".',
    );
  }

  res.json(importService.importCsv(req.body));
});
