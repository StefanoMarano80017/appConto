import type { ErrorRequestHandler, RequestHandler } from 'express';
import { DomainError, type DomainErrorCode } from '../errors.js';
import { logger } from '../logger.js';

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Risorsa non trovata: ${req.method} ${req.originalUrl}` });
};

/**
 * Unico punto in cui gli errori diventano risposte HTTP.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof DomainError) {
    res.status(STATUS_BY_CODE[error.code]).json({ error: error.message });
    return;
  }

  logger.error('Errore non gestito', error);
  res.status(500).json({ error: 'Errore interno del server.' });
};
