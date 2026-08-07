import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Tabella delle impostazioni: una sola riga, con identificativo fisso.
 *
 * Il saldo è in centesimi, come gli importi delle transazioni.
 */
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  initialBalanceCents: integer('initial_balance_cents').notNull(),
  balanceDate: text('balance_date'),
});

/** Identificativo dell'unica riga. */
export const SETTINGS_ID = 'default';
