import { asc, eq, inArray } from 'drizzle-orm';
import { atomically, db } from '../../db/client.js';
import type { Merchant } from './merchant.model.js';
import { merchants } from './merchants.schema.js';

/** SQLite limita il numero di parametri per statement: lavoriamo a blocchi. */
const CHUNK_SIZE = 500;

export const merchantsRepository = {
  findAll(): Merchant[] {
    return db.select().from(merchants).orderBy(asc(merchants.name)).all();
  },

  findById(id: string): Merchant | null {
    return db.select().from(merchants).where(eq(merchants.id, id)).get() ?? null;
  },

  findByNormalizedNames(normalizedNames: readonly string[]): Merchant[] {
    const found: Merchant[] = [];

    for (let i = 0; i < normalizedNames.length; i += CHUNK_SIZE) {
      const chunk = normalizedNames.slice(i, i + CHUNK_SIZE);
      found.push(
        ...db.select().from(merchants).where(inArray(merchants.normalizedName, chunk)).all(),
      );
    }

    return found;
  },

  /** Archivia i merchant indicati, tutti o nessuno. */
  insertMany(items: readonly Merchant[]): void {
    atomically(() => {
      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        db.insert(merchants)
          .values(items.slice(i, i + CHUNK_SIZE))
          .run();
      }
    });
  },

  updateCategory(id: string, categoryId: string | null): void {
    db.update(merchants).set({ categoryId }).where(eq(merchants.id, id)).run();
  },

  updateDisplayName(id: string, displayName: string | null): void {
    db.update(merchants).set({ displayName }).where(eq(merchants.id, id)).run();
  },
};
