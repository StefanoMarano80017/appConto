import { Router, json } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { toMerchantDto, toMerchantSummaryDto } from './merchants.dto.js';
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

// GET /merchants
merchantsRouter.get('/', (_req, res) => {
  res.json(merchantsService.listAllWithCategory().map(toMerchantDto));
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
