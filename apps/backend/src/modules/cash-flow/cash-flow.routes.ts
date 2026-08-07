import { Router } from 'express';
import { ValidationError } from '../../shared/errors.js';
import { cashFlowService } from './cash-flow.service.js';

export const cashFlowRouter = Router();

// GET /cash-flow?month=YYYY-MM — senza `month` considera tutto l'archivio
cashFlowRouter.get('/', (req, res) => {
  const month = req.query.month;
  if (month !== undefined && typeof month !== 'string') {
    throw new ValidationError('Parametro "month" non valido: atteso il formato YYYY-MM.');
  }

  res.json(cashFlowService.getCashFlow(month));
});
