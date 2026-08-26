import { Router } from 'express';
import { queryParam } from '../../shared/http/query-params.js';
import { analyticsService } from './analytics.service.js';
import { parseAnalyticsQuery } from './analytics.query.js';

export const analyticsRouter = Router();

// GET /analytics?from=&to=&types=&categoryIds=&merchantIds=&classification=
analyticsRouter.get('/', (req, res) => {
  const query = parseAnalyticsQuery({
    from: queryParam(req.query.from, 'from'),
    to: queryParam(req.query.to, 'to'),
    types: queryParam(req.query.types, 'types'),
    categoryIds: queryParam(req.query.categoryIds, 'categoryIds'),
    merchantIds: queryParam(req.query.merchantIds, 'merchantIds'),
    classification: queryParam(req.query.classification, 'classification'),
    granularity: queryParam(req.query.granularity, 'granularity'),
  });

  res.json(analyticsService.getAnalytics(query));
});
