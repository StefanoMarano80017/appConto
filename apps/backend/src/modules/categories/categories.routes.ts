import { Router } from 'express';
import { toCategoryDto } from './categories.dto.js';
import { categoriesService } from './categories.service.js';

export const categoriesRouter = Router();

// GET /categories
categoriesRouter.get('/', (_req, res) => {
  res.json(categoriesService.listAll().map(toCategoryDto));
});
