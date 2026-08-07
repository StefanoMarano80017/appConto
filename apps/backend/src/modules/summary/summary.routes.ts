import { Router } from 'express';
import { ValidationError } from '../../shared/errors.js';
import { summaryService } from './summary.service.js';

export const summaryRouter = Router();

// GET /summary?month=YYYY-MM
summaryRouter.get('/', (req, res) => {
  const month = req.query.month;
  if (typeof month !== 'string') {
    throw new ValidationError('Parametro "month" mancante: atteso il formato YYYY-MM.');
  }

  res.json(summaryService.getMonthlySummary(month));
});
