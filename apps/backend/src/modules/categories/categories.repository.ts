import { asc, count, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { merchants } from '../merchants/merchants.schema.js';
import type { Category } from './category.model.js';
import { categories } from './categories.schema.js';

export const categoriesRepository = {
  findAll(): Category[] {
    return db.select().from(categories).orderBy(asc(categories.name)).all();
  },

  findById(id: string): Category | null {
    return db.select().from(categories).where(eq(categories.id, id)).get() ?? null;
  },

  findByName(name: string): Category | null {
    return db.select().from(categories).where(eq(categories.name, name)).get() ?? null;
  },

  insert(category: Category): void {
    db.insert(categories).values(category).run();
  },

  update(id: string, patch: { name?: string; color?: string | null }): void {
    db.update(categories).set(patch).where(eq(categories.id, id)).run();
  },

  /** Quanti merchant sono assegnati a ciascuna categoria, per id. */
  countMerchantsByCategory(): Map<string, number> {
    const rows = db
      .select({ categoryId: merchants.categoryId, total: count() })
      .from(merchants)
      .groupBy(merchants.categoryId)
      .all();

    const result = new Map<string, number>();
    for (const row of rows) {
      if (row.categoryId !== null) {
        result.set(row.categoryId, row.total);
      }
    }

    return result;
  },

  /** Quanti merchant sono assegnati a una categoria specifica. */
  countMerchantsForCategory(id: string): number {
    const row = db.select({ total: count() }).from(merchants).where(eq(merchants.categoryId, id)).get();

    return row?.total ?? 0;
  },
};
