import { Router, json } from 'express';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { queryParam } from '../../shared/http/query-params.js';
import { parseTransactionQuery } from './transaction-query.js';
import { TRANSACTION_TYPES, transactionTypeSchema } from './transaction-type.js';
import { toTransactionDto, toTransactionPageDto } from './transactions.dto.js';
import { transactionsService, type TransactionDependents } from './transactions.service.js';

const updateTypeBodySchema = z.object({ type: transactionTypeSchema });

/**
 * Il corpo di un'eliminazione.
 *
 * Un tetto al numero di identificativi, e non per prudenza generica: la
 * richiesta nasce da una selezione a schermo, quindi qualche centinaio è il
 * massimo plausibile, e un elenco di centomila voci è una richiesta malformata
 * da rifiutare prima di toccare il database.
 */
const removeBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
});

/**
 * Le rotte dei movimenti.
 *
 * È una fabbrica e non un router già costruito perché l'eliminazione deve
 * sapere chi altro usa un movimento, e quella conoscenza non appartiene a
 * questa feature: le transazioni stanno a monte di tutto e non devono
 * conoscere i propri consumatori. Chi compone l'applicazione le collega.
 */
export function createTransactionsRouter(dependents: TransactionDependents): Router {
  const transactionsRouter = Router();

  /** L'identificativo dal percorso, oppure una richiesta malformata. */
  const requireId = (value: string | undefined): string => {
    if (value === undefined) {
      throw new ValidationError('Identificativo della transazione mancante.');
    }

    return value;
  };

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

  /*
   * DELETE /transactions — elimina i movimenti indicati nel corpo.
   *
   * Sulla collezione e non su `/:id`, perché l'operazione è una: l'utente
   * seleziona un insieme e lo elimina. Una richiesta per riga sarebbe una
   * sequenza di operazioni indipendenti, e un guasto a metà lascerebbe una
   * selezione eliminata in parte — con nulla da annullare.
   */
  transactionsRouter.delete('/', json(), (req, res) => {
    const body = removeBodySchema.safeParse(req.body);
    if (!body.success) {
      throw new ValidationError(
        'Il corpo della richiesta deve contenere "ids": un elenco di identificativi, da 1 a 1000.',
      );
    }

    res.json(transactionsService.remove(body.data.ids, dependents));
  });

  // GET /transactions/:id — una singola transazione, con il proprio merchant
  transactionsRouter.get('/:id', (req, res) => {
    const id = requireId(req.params.id);

    const entry = transactionsService.findByIdWithMerchant(id);
    if (entry === null) {
      throw new NotFoundError(`Transazione "${id}" non trovata.`);
    }

    res.json(toTransactionDto(entry));
  });

  // PATCH /transactions/:id/type — correzione manuale della natura del movimento
  transactionsRouter.patch('/:id/type', json(), (req, res) => {
    const id = requireId(req.params.id);

    const body = updateTypeBodySchema.safeParse(req.body);
    if (!body.success) {
      throw new ValidationError(
        `Il corpo della richiesta deve contenere "type" fra: ${TRANSACTION_TYPES.join(', ')}.`,
      );
    }

    const updated = transactionsService.updateType(id, body.data.type);

    res.json({ id: updated.id, type: updated.type });
  });

  return transactionsRouter;
}
