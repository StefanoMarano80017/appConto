import type { ErrorRequestHandler, RequestHandler } from 'express';
import { DomainError, type DomainErrorCode } from '../errors.js';
import { logger } from '../logger.js';

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Risorsa non trovata: ${req.method} ${req.originalUrl}` });
};

/**
 * Un corpo che non si riesce a leggere è colpa della richiesta, non del server.
 *
 * `express.json()` solleva un errore con uno `status` proprio quando il corpo
 * non è JSON valido, è troppo grande, o — in modalità strict — non è un oggetto
 * né un array. Senza questo riconoscimento quegli errori finivano nel ramo
 * generico e uscivano come **500**: al client veniva detto che il guasto era
 * del server, mentre era la sua richiesta a essere malformata.
 *
 * Il messaggio non viene ripetuto: quello di body-parser è in inglese e parla
 * di token e di byte. Quello che serve a chi chiama è la categoria.
 */
function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const status = (error as { status?: unknown; statusCode?: unknown });
  const value = typeof status.status === 'number' ? status.status : status.statusCode;

  return typeof value === 'number' && value >= 400 && value < 500 ? value : null;
}

/**
 * Unico punto in cui gli errori diventano risposte HTTP.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof DomainError) {
    res.status(STATUS_BY_CODE[error.code]).json({ error: error.message });
    return;
  }

  const client = clientErrorStatus(error);
  if (client !== null) {
    res.status(client).json({ error: 'Richiesta non valida: il corpo non è leggibile.' });
    return;
  }

  logger.error('Errore non gestito', error);
  res.status(500).json({ error: 'Errore interno del server.' });
};
