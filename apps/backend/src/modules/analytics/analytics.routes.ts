import { Router } from "express";
import { queryParam } from "../../shared/http/query-params.js";
import { parseAnalyticsQuery } from "./analytics.query.js";
import type { analyticsService } from "./analytics.service.js";

type AnalyticsService = Pick<typeof analyticsService, "getAnalytics">;

function createAnalyticsQuery(query: Record<string, unknown>) {
  return parseAnalyticsQuery({
    from: queryParam(query.from, "from"),
    to: queryParam(query.to, "to"),
    types: queryParam(query.types, "types"),
    categoryIds: queryParam(query.categoryIds, "categoryIds"),
    merchantIds: queryParam(query.merchantIds, "merchantIds"),
    classification: queryParam(query.classification, "classification"),
    granularity: queryParam(query.granularity, "granularity"),
  });
}

async function createAnalyticsService(
  service?: AnalyticsService,
): Promise<AnalyticsService> {
  return service ?? (await import("./analytics.service.js")).analyticsService;
}

export function createAnalyticsRouter(service?: AnalyticsService): Router {
  const analyticsRouter = Router();
  // GET /analytics?from=&to=&types=&categoryIds=&merchantIds=&classification=
  analyticsRouter.get("/", async (req, res) => {
    const query = createAnalyticsQuery(req.query);
    const analyticsService = await createAnalyticsService(service);
    res.json(analyticsService.getAnalytics(query));
  });

  return analyticsRouter;
}

export const analyticsRouter = createAnalyticsRouter();
