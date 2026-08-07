import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import type { Settings } from './settings.model.js';
import { SETTINGS_ID, settings } from './settings.schema.js';

/** Valori usati finché l'utente non indica un saldo di partenza. */
const DEFAULTS: Settings = { initialBalance: 0, balanceDate: null };

export const settingsRepository = {
  get(): Settings {
    const row = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
    if (row === undefined) {
      return DEFAULTS;
    }

    return {
      initialBalance: row.initialBalanceCents / 100,
      balanceDate: row.balanceDate,
    };
  },

  save({ initialBalance, balanceDate }: Settings): void {
    const values = {
      id: SETTINGS_ID,
      initialBalanceCents: Math.round(initialBalance * 100),
      balanceDate,
    };

    db.insert(settings)
      .values(values)
      .onConflictDoUpdate({ target: settings.id, set: values })
      .run();
  },
};
