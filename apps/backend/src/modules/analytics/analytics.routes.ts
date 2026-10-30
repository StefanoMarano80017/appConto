import { Router } from 'express';
import { queryParam } from '../../shared/http/query-params.js';
import { parseAnalyticsQuery } from './analytics.query.js';
import type { analyticsService } from './analytics.service.js';

type AnalyticsService = Pick<typeof analyticsService, 'getAnalytics'>;

export function createAnalyticsRouter(service?: AnalyticsService): Router {
  const analyticsRouter = Router();

  // GET /analytics?from=&to=&types=&categoryIds=&merchantIds=&classification=
  analyticsRouter.get('/', async (req, res) => {
    const query = parseAnalyticsQuery({
      from: queryParam(req.query.from, 'from'),
      to: queryParam(req.query.to, 'to'),
      types: queryParam(req.query.types, 'types'),
      categoryIds: queryParam(req.query.categoryIds, 'categoryIds'),
      merchantIds: queryParam(req.query.merchantIds, 'merchantIds'),
      classification: queryParam(req.query.classification, 'classification'),
      granularity: queryParam(req.query.granularity, 'granularity'),
    });

    const analyticsService =
      service ?? (await import('./analytics.service.js')).analyticsService;

    res.json(analyticsService.getAnalytics(query));
  });

  return analyticsRouter;
}

export const analyticsRouter = createAnalyticsRouter();
