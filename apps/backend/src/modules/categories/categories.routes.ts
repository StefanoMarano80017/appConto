import { Router, json } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { toCategoryDto, toCategoryWithUsageDto } from './categories.dto.js';
import { categoriesService } from './categories.service.js';

export const categoriesRouter = Router();

const createCategoryBodySchema = z.object({
  name: z.string().trim().min(1),
  color: z.string().trim().min(1).nullable().optional(),
});

const updateCategoryBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    color: z.string().trim().min(1).nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.color !== undefined, {
    message: 'Il corpo della richiesta deve contenere "name" e/o "color".',
  });

function categoryId(value: string | undefined): string {
  if (value === undefined) {
    throw new ValidationError('Identificativo della categoria mancante.');
  }

  return value;
}

// GET /categories
categoriesRouter.get('/', (_req, res) => {
  res.json(categoriesService.listAllWithUsage().map(toCategoryWithUsageDto));
});

// GET /categories/:id/usage
categoriesRouter.get('/:id/usage', (req, res) => {
  const id = categoryId(req.params.id);

  res.json({ merchantCount: categoriesService.usage(id) });
});

// POST /categories
categoriesRouter.post('/', json(), (req, res) => {
  const body = createCategoryBodySchema.safeParse(req.body);
  if (!body.success) {
    throw new ValidationError('Il corpo della richiesta deve contenere "name".');
  }

  const created = categoriesService.create({ name: body.data.name, color: body.data.color ?? null });

  res.status(201).json(toCategoryDto(created));
});

// PATCH /categories/:id
categoriesRouter.patch('/:id', json(), (req, res) => {
  const id = categoryId(req.params.id);
  const body = updateCategoryBodySchema.safeParse(req.body);
  if (!body.success) {
    throw new ValidationError('Il corpo della richiesta deve contenere "name" e/o "color".');
  }

  const patch: { name?: string; color?: string | null } = {};
  if (body.data.name !== undefined) {
    patch.name = body.data.name;
  }
  if (body.data.color !== undefined) {
    patch.color = body.data.color;
  }

  const updated = categoriesService.update(id, patch);
  const merchantCount = categoriesService.usage(id);

  res.json(toCategoryWithUsageDto({ ...updated, merchantCount }));
});

// DELETE /categories/:id
categoriesRouter.delete('/:id', (req, res) => {
  const id = categoryId(req.params.id);

  categoriesService.remove(id);

  res.status(204).send();
});
