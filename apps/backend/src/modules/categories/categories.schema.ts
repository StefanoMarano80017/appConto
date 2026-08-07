import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Tabella SQLite delle categorie.
 *
 * Il contenuto iniziale è inserito da una migrazione dedicata: il nome è
 * univoco, quindi il seed non può essere applicato due volte.
 */
export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color'),
});
