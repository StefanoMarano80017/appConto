import { Router } from 'express';
import { ValidationError } from '../../shared/errors.js';
import { parseFilters } from './dashboard-filters.js';
import { dashboardService } from './dashboard.service.js';

export const dashboardRouter = Router();

function optional(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError(`Parametro "${name}" non valido.`);
  }

  return value;
}

// GET /dashboard?month=YYYY-MM&type=&categoryId=&merchantId=
dashboardRouter.get('/', (req, res) => {
  const month = req.query.month;
  if (typeof month !== 'string') {
    throw new ValidationError('Parametro "month" mancante: atteso il formato YYYY-MM.');
  }

  const filters = parseFilters({
    type: optional(req.query.type, 'type'),
    categoryId: optional(req.query.categoryId, 'categoryId'),
    merchantId: optional(req.query.merchantId, 'merchantId'),
  });

  res.json(dashboardService.getDashboard(month, filters));
});
