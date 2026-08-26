import { Router, json } from 'express';
import { ValidationError } from '../../shared/errors.js';
import { queryParam } from '../../shared/http/query-params.js';
import { parseLoanQuery } from './loan-query.js';
import { loansService } from './loans.service.js';

export const loansRouter = Router();

/** Un identificativo mancante non è una risorsa inesistente: è una richiesta malformata. */
function required(value: string | undefined, what: string): string {
  if (value === undefined) {
    throw new ValidationError(`Identificativo ${what} mancante.`);
  }

  return value;
}

// GET /loans/links — registrata prima delle rotte con parametro
loansRouter.get('/links', (_req, res) => {
  res.json(loansService.links());
});

// GET /loans?status=open|settled|all&borrower=&search=&sortBy=&sortDirection=
loansRouter.get('/', (req, res) => {
  const query = parseLoanQuery({
    status: queryParam(req.query.status, 'status'),
    borrower: queryParam(req.query.borrower, 'borrower'),
    search: queryParam(req.query.search, 'search'),
    sortBy: queryParam(req.query.sortBy, 'sortBy'),
    sortDirection: queryParam(req.query.sortDirection, 'sortDirection'),
  });

  res.json(loansService.list(query));
});

// GET /loans/:id
loansRouter.get('/:id', (req, res) => {
  res.json(loansService.getById(required(req.params.id, 'del prestito')));
});

// POST /loans — il prestito nasce da una transazione di tipo LOAN, mai dall'import
loansRouter.post('/', json(), (req, res) => {
  res.status(201).json(loansService.create(req.body));
});

// PATCH /loans/:id
loansRouter.patch('/:id', json(), (req, res) => {
  res.json(loansService.update(required(req.params.id, 'del prestito'), req.body));
});

// DELETE /loans/:id — consentito solo senza restituzioni registrate
loansRouter.delete('/:id', (req, res) => {
  loansService.remove(required(req.params.id, 'del prestito'));
  res.status(204).end();
});

// POST /loans/:id/repayments
loansRouter.post('/:id/repayments', json(), (req, res) => {
  res.status(201).json(loansService.addRepayment(required(req.params.id, 'del prestito'), req.body));
});

// PATCH /loans/:id/repayments/:repaymentId
loansRouter.patch('/:id/repayments/:repaymentId', json(), (req, res) => {
  res.json(
    loansService.updateRepayment(
      required(req.params.id, 'del prestito'),
      required(req.params.repaymentId, 'della restituzione'),
      req.body,
    ),
  );
});

// DELETE /loans/:id/repayments/:repaymentId
loansRouter.delete('/:id/repayments/:repaymentId', (req, res) => {
  res.json(
    loansService.removeRepayment(
      required(req.params.id, 'del prestito'),
      required(req.params.repaymentId, 'della restituzione'),
    ),
  );
});
