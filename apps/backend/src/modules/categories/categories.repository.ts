import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import type { Category } from './category.model.js';
import { categories } from './categories.schema.js';

export const categoriesRepository = {
  findAll(): Category[] {
    return db.select().from(categories).orderBy(asc(categories.name)).all();
  },

  findById(id: string): Category | null {
    return db.select().from(categories).where(eq(categories.id, id)).get() ?? null;
  },
};
