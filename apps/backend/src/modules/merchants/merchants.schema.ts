import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { categories } from '../categories/categories.schema.js';

/**
 * Tabella SQLite dei merchant.
 *
 * `normalized_name` è univoco: è ciò che garantisce che uno stesso esercente
 * venga creato una sola volta, anche importando più estratti conto.
 *
 * `categories` viene importato solo per dichiarare il vincolo di integrità
 * referenziale: a runtime il repository interroga esclusivamente questa tabella.
 */
export const merchants = sqliteTable('merchants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull().unique(),
  categoryId: text('category_id').references(() => categories.id),
  displayName: text('display_name'),
});
