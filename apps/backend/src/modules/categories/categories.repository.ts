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
};
