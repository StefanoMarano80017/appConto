import { Router } from 'express';
import { ValidationError } from '../../shared/errors.js';
import { dashboardService } from './dashboard.service.js';

export const dashboardRouter = Router();

/** Data locale del server in `YYYY-MM-DD` (non UTC: "oggi" è quello dell'utente). */
function localToday(): string {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

// GET /dashboard?month=YYYY-MM  (senza month: il mese dell'ultimo movimento)
dashboardRouter.get('/', (req, res) => {
  const month = req.query.month;
  if (month !== undefined && typeof month !== 'string') {
    throw new ValidationError('Parametro "month" non valido: atteso il formato YYYY-MM.');
  }

  res.json(dashboardService.getDashboard(month, localToday()));
});
