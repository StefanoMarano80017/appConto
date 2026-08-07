import { Router, json } from 'express';
import { settingsService } from './settings.service.js';

export const settingsRouter = Router();

// GET /settings
settingsRouter.get('/', (_req, res) => {
  res.json(settingsService.get());
});

// PATCH /settings
settingsRouter.patch('/', json(), (req, res) => {
  res.json(settingsService.update(req.body));
});
