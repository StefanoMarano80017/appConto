import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { after, before, describe, it } from 'node:test';
import { errorHandler } from '../../shared/http/error-handler.js';
import type { AnalyticsQuery } from './analytics.query.js';
import { analyticsRouter, createAnalyticsRouter } from './analytics.routes.js';
import type { AnalyticsViewModel } from './analytics.view-model.js';

const expectedQuery = {
  from: '2026-01-02',
  to: '2026-03-04',
  types: ['EXPENSE', 'INCOME'],
  categoryIds: ['category-1', 'category-2'],
  merchantIds: ['merchant-1', 'merchant-2'],
  classification: 'classified',
  granularity: 'week',
} satisfies AnalyticsQuery;

const result = {
  period: {
    from: expectedQuery.from,
    to: expectedQuery.to,
    firstTransactionDate: '2026-01-02',
    lastTransactionDate: '2026-03-04',
  },
  query: expectedQuery,
  overview: {
    income: 100,
    expenses: 20,
    balance: 80,
    withdrawals: 0,
    loans: 0,
    transfers: 0,
    other: 0,
    netMovement: 80,
  },
  counts: { transactions: 2, merchants: 1, categories: 1 },
  byCategory: [],
  byMerchant: [],
  timeline: { granularity: 'week', buckets: [] },
  loans: { lent: 0, transactionCount: 0, entries: [] },
} satisfies AnalyticsViewModel;

const calls: AnalyticsQuery[] = [];
const app = express();
app.use(createAnalyticsRouter({
  getAnalytics(query) {
    calls.push(query);

    return result;
  },
}));
app.use('/production', analyticsRouter);
app.use(errorHandler);

const server = app.listen(0, '127.0.0.1');
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(port)}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`);

  return { status: response.status, body: await response.json() };
}

describe('GET /analytics', () => {
  it('passes validated query parameters to the service and returns its result', async () => {
    calls.length = 0;

    const response = await get(
      '/?from=2026-01-02&to=2026-03-04&types=EXPENSE,INCOME' +
        '&categoryIds=category-1,category-2&merchantIds=merchant-1,merchant-2' +
        '&classification=classified&granularity=week',
    );

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [expectedQuery]);
    assert.deepEqual(response.body, result);
  });

  it('does not call the service when query validation fails', async () => {
    calls.length = 0;

    const response = await get('/?from=not-a-date');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      error: 'La data "from" deve essere nel formato YYYY-MM-DD.',
    });
    assert.deepEqual(calls, []);
  });

  it('exports a production router that still uses the shared error handler', async () => {
    const response = await get('/production?from=not-a-date');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      error: 'La data "from" deve essere nel formato YYYY-MM-DD.',
    });
  });
});
