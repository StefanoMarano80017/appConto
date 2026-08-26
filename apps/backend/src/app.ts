import cors from 'cors';
import express, { type Express } from 'express';
import { analyticsRouter } from './modules/analytics/index.js';
import { cashFlowRouter } from './modules/cash-flow/index.js';
import { categoriesRouter } from './modules/categories/index.js';
import { dashboardRouter } from './modules/dashboard/index.js';
import { importRouter } from './modules/import/index.js';
import { loansRouter } from './modules/loans/index.js';
import { merchantsRouter } from './modules/merchants/index.js';
import { settingsRouter } from './modules/settings/index.js';
import { summaryRouter } from './modules/summary/index.js';
import { transactionsRouter } from './modules/transactions/index.js';
import { errorHandler, notFoundHandler } from './shared/http/error-handler.js';

/**
 * Composizione dell'applicazione HTTP.
 *
 * Qui vengono montate le feature: nessuna logica di dominio.
 */
export function createApp(): Express {
  const app = express();

  app.use(cors());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/analytics', analyticsRouter);
  app.use('/cash-flow', cashFlowRouter);
  app.use('/categories', categoriesRouter);
  app.use('/dashboard', dashboardRouter);
  app.use('/settings', settingsRouter);
  app.use('/import', importRouter);
  app.use('/loans', loansRouter);
  app.use('/merchants', merchantsRouter);
  app.use('/summary', summaryRouter);
  app.use('/transactions', transactionsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
