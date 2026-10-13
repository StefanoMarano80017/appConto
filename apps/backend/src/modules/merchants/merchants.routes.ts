import { Router, json } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { queryParam } from '../../shared/http/query-params.js';
import { parseMerchantQuery } from './merchant-query.js';
import { toMerchantDto, toMerchantPageDto, toMerchantSummaryDto } from './merchants.dto.js';
import { merchantsService } from './merchants.service.js';

export const merchantsRouter = Router();

const assignCategoryBodySchema = z.object({
  /** `null` rimuove la categoria dal merchant. */
  categoryId: z.string().trim().min(1).nullable(),
});

const updateMerchantBodySchema = z.object({
  /** `null` o stringa vuota ripristinano il nome originale della banca. */
  displayName: z.string().nullable(),
});

function merchantId(value: string | undefined): string {
  if (value === undefined) {
    throw new ValidationError('Identificativo del merchant mancante.');
  }

  return value;
}

// GET /merchants/summary — registrata prima delle rotte con parametro
merchantsRouter.get('/summary', (_req, res) => {
  res.json(merchantsService.listSummaries().map(toMerchantSummaryDto));
});

// GET /merchants?search=&classification=&page=&pageSize=&sortBy=&sortDirection=
merchantsRouter.get('/', (req, res) => {
  const query = parseMerchantQuery({
    search: queryParam(req.query.search, 'search'),
    classification: queryParam(req.query.classification, 'classification'),
    page: queryParam(req.query.page, 'page'),
    pageSize: queryParam(req.query.pageSize, 'pageSize'),
    sortBy: queryParam(req.query.sortBy, 'sortBy'),
    sortDirection: queryParam(req.query.sortDirection, 'sortDirection'),
  });

  res.json(toMerchantPageDto(merchantsService.search(query)));
});

// PATCH /merchants/:id — rinomina, indipendente dalla categoria
merchantsRouter.patch('/:id', json(), (req, res) => {
  const body = updateMerchantBodySchema.safeParse(req.body);
  if (!body.success) {
    throw new ValidationError('Il corpo della richiesta deve contenere "displayName".');
  }

  res.json(
    toMerchantDto(merchantsService.updateDisplayName(merchantId(req.params.id), body.data.displayName)),
  );
});

// PATCH /merchants/:id/category
merchantsRouter.patch('/:id/category', json(), (req, res) => {
  const body = assignCategoryBodySchema.safeParse(req.body);
  if (!body.success) {
    throw new ValidationError('Il corpo della richiesta deve contenere "categoryId".');
  }

  res.json(
    toMerchantDto(merchantsService.assignCategory(merchantId(req.params.id), body.data.categoryId)),
  );
});
