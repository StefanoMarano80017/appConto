import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import type { Settings } from './settings.model.js';
import { settingsRepository } from './settings.repository.js';

const settingsUpdateSchema = z.object({
  initialBalance: z.number().finite().optional(),
  balanceDate: z.iso.date().nullable().optional(),
});

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

/** Servizio pubblico della feature: unico punto di accesso per le altre feature. */
export const settingsService = {
  get(): Settings {
    return settingsRepository.get();
  },

  /** Aggiorna solo i campi indicati, lasciando gli altri invariati. */
  update(update: unknown): Settings {
    const parsed = settingsUpdateSchema.safeParse(update);
    if (!parsed.success) {
      throw new ValidationError(
        'Impostazioni non valide: "initialBalance" deve essere un numero e "balanceDate" una data YYYY-MM-DD o null.',
      );
    }

    const current = settingsRepository.get();
    const next: Settings = {
      initialBalance: parsed.data.initialBalance ?? current.initialBalance,
      balanceDate:
        parsed.data.balanceDate === undefined ? current.balanceDate : parsed.data.balanceDate,
    };

    settingsRepository.save(next);

    return next;
  },
};
