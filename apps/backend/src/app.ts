import express, { Router, type Express } from 'express';
import { config } from './config.js';
import { analyticsRouter } from './modules/analytics/index.js';
import { cashFlowRouter } from './modules/cash-flow/index.js';
import { categoriesRouter } from './modules/categories/index.js';
import { dashboardRouter } from './modules/dashboard/index.js';
import { importRouter } from './modules/import/index.js';
import { loansRouter } from './modules/loans/index.js';
import { backupsRouter, restoreRouter } from './modules/maintenance/index.js';
import { merchantsRouter } from './modules/merchants/index.js';
import { settingsRouter } from './modules/settings/index.js';
import { summaryRouter } from './modules/summary/index.js';
import { transactionsRouter } from './modules/transactions/index.js';
import { errorHandler, notFoundHandler } from './shared/http/error-handler.js';
import { hostAllowlist, sameOriginMutations } from './shared/http/local-only.js';
import { spaFallback, staticAssets } from './shared/http/static-frontend.js';

/**
 * Le API dell'applicazione. Nessuna vive fuori da questo router.
 *
 * Il prefisso `/api`, applicato dove il router viene montato, è ciò che
 * permette a `/transactions` di essere una rotta dell'interfaccia e a
 * `/api/transactions` di essere una chiamata all'archivio.
 */
function createApiRouter(): Router {
  const api = Router();

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  api.use('/analytics', analyticsRouter);
  api.use('/backups', backupsRouter);
  api.use('/cash-flow', cashFlowRouter);
  api.use('/categories', categoriesRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/settings', settingsRouter);
  api.use('/import', importRouter);
  api.use('/loans', loansRouter);
  api.use('/merchants', merchantsRouter);
  // Prepara la sostituzione dell'archivio, non la esegue: applicarla spetta
  // all'avvio successivo, quando il database non è aperto da nessuno.
  api.use('/restore', restoreRouter);
  api.use('/summary', summaryRouter);
  api.use('/transactions', transactionsRouter);

  // Una rotta inesistente sotto `/api` è un errore dell'API, non uno stato
  // dell'interfaccia: va chiusa qui, prima che il fallback le risponda con
  // `index.html`.
  api.use(notFoundHandler);

  return api;
}

/**
 * Composizione dell'applicazione HTTP.
 *
 * Qui vengono montate le feature: nessuna logica di dominio.
 *
 * L'ordine è parte del contratto:
 *
 *   1. il perimetro — chi può parlare con questo server;
 *   2. le API sotto `/api`;
 *   3. i file della build del frontend;
 *   4. il fallback che restituisce l'applicazione per le rotte Angular.
 *
 * `frontendDir` è un parametro perché i test possano descrivere una build
 * qualsiasi senza dipendere da quella reale.
 */
export function createApp(frontendDir: string = config.frontendDir): Express {
  const app = express();

  app.use(hostAllowlist);
  app.use(sameOriginMutations);

  app.use('/api', createApiRouter());

  app.use(staticAssets(frontendDir));
  // Express 5 non accetta più `'*'` come percorso: l'espressione regolare è
  // l'equivalente che non dipende dalla sintassi dei percorsi.
  app.get(/.*/, spaFallback(frontendDir));

  // Un metodo diverso da GET su un percorso che non è un'API non esiste.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
