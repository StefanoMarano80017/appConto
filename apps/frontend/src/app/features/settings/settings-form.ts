import { parseAmount } from '../../core/amount';
import { Settings } from './settings.model';

/** Valori così come li digita l'utente. */
export interface SettingsFormValue {
  balanceDate: string;
  initialBalance: string;
}

export interface SettingsFormErrors {
  balanceDate?: string;
  initialBalance?: string;
}

export type SettingsFormResult =
  | { valid: true; settings: Settings }
  | { valid: false; errors: SettingsFormErrors };

/**
 * Validazione del modulo impostazioni.
 *
 * La data è obbligatoria — senza un punto di partenza la liquidità non è
 * calcolabile — mentre l'importo può essere negativo: un conto può essere
 * in rosso.
 */
export function validateSettingsForm({
  balanceDate,
  initialBalance
}: SettingsFormValue): SettingsFormResult {
  const errors: SettingsFormErrors = {};

  const date = balanceDate.trim();
  if (date === '') {
    errors.balanceDate = 'Indica la data del saldo.';
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.balanceDate = 'La data deve essere nel formato AAAA-MM-GG.';
  }

  const amount = parseAmount(initialBalance);
  if (initialBalance.trim() === '') {
    errors.initialBalance = 'Indica il saldo iniziale.';
  } else if (amount === null) {
    errors.initialBalance = 'Il saldo deve essere un importo numerico.';
  }

  if (Object.keys(errors).length > 0 || amount === null) {
    return { valid: false, errors };
  }

  return { valid: true, settings: { balanceDate: date, initialBalance: amount } };
}
