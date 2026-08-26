import { Router, json } from 'express';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { queryParam } from '../../shared/http/query-params.js';
import { parseTransactionQuery } from './transaction-query.js';
import { TRANSACTION_TYPES, transactionTypeSchema } from './transaction-type.js';
import { toTransactionDto, toTransactionPageDto } from './transactions.dto.js';
import { transactionsService } from './transactions.service.js';

export const transactionsRouter = Router();

const updateTypeBodySchema = z.object({ type: transactionTypeSchema });

// GET /transactions?from=&to=&search=&types=&categoryIds=&merchantIds=&classification=
//                  &minAmount=&maxAmount=&page=&pageSize=&sortBy=&sortDirection=
transactionsRouter.get('/', (req, res) => {
  const query = parseTransactionQuery({
    from: queryParam(req.query.from, 'from'),
    to: queryParam(req.query.to, 'to'),
    search: queryParam(req.query.search, 'search'),
    types: queryParam(req.query.types, 'types'),
    categoryIds: queryParam(req.query.categoryIds, 'categoryIds'),
    merchantIds: queryParam(req.query.merchantIds, 'merchantIds'),
    classification: queryParam(req.query.classification, 'classification'),
    minAmount: queryParam(req.query.minAmount, 'minAmount'),
    maxAmount: queryParam(req.query.maxAmount, 'maxAmount'),
    page: queryParam(req.query.page, 'page'),
    pageSize: queryParam(req.query.pageSize, 'pageSize'),
    sortBy: queryParam(req.query.sortBy, 'sortBy'),
    sortDirection: queryParam(req.query.sortDirection, 'sortDirection'),
  });

  res.json(toTransactionPageDto(transactionsService.search(query)));
});

// GET /transactions/:id — una singola transazione, con il proprio merchant
transactionsRouter.get('/:id', (req, res) => {
  const id = req.params.id;
  if (id === undefined) {
    throw new ValidationError('Identificativo della transazione mancante.');
  }

  const entry = transactionsService.findByIdWithMerchant(id);
  if (entry === null) {
    throw new NotFoundError(`Transazione "${id}" non trovata.`);
  }

  res.json(toTransactionDto(entry));
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
