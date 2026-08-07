import { Router, json } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { TRANSACTION_TYPES, transactionTypeSchema } from './transaction-type.js';
import { toTransactionDto } from './transactions.dto.js';
import { transactionsService } from './transactions.service.js';

export const transactionsRouter = Router();

const updateTypeBodySchema = z.object({ type: transactionTypeSchema });

// GET /transactions
transactionsRouter.get('/', (_req, res) => {
  res.json(transactionsService.listAllWithMerchant().map(toTransactionDto));
});

// PATCH /transactions/:id/type — correzione manuale della natura del movimento
transactionsRouter.patch('/:id/type', json(), (req, res) => {
  const id = req.params.id;
  if (id === undefined) {
    throw new ValidationError('Identificativo della transazione mancante.');
  }

  const body = updateTypeBodySchema.safeParse(req.body);
  if (!body.success) {
    throw new ValidationError(
      `Il corpo della richiesta deve contenere "type" fra: ${TRANSACTION_TYPES.join(', ')}.`,
    );
  }

  const updated = transactionsService.updateType(id, body.data.type);

  res.json({ id: updated.id, type: updated.type });
});
