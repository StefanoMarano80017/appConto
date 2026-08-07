import { validateSettingsForm } from './settings-form';

describe('validateSettingsForm', () => {
  const valid = { balanceDate: '2026-06-30', initialBalance: '2000' };

  it('accetta una data e un importo validi', () => {
    expect(validateSettingsForm(valid)).toEqual({
      valid: true,
      settings: { balanceDate: '2026-06-30', initialBalance: 2000 }
    });
  });

  it('richiede la data', () => {
    const result = validateSettingsForm({ ...valid, balanceDate: '   ' });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.balanceDate).toBeTruthy();
  });

  it('rifiuta una data in formato non valido', () => {
    const result = validateSettingsForm({ ...valid, balanceDate: '30/06/2026' });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.balanceDate).toContain('AAAA-MM-GG');
  });

  it('richiede un importo numerico', () => {
    const result = validateSettingsForm({ ...valid, initialBalance: 'duemila' });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.initialBalance).toBeTruthy();
  });

  it('richiede che l\'importo sia presente', () => {
    const result = validateSettingsForm({ ...valid, initialBalance: '' });

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.initialBalance).toBeTruthy();
  });

  it('ammette valori negativi: un conto può essere in rosso', () => {
    expect(validateSettingsForm({ ...valid, initialBalance: '-150,25' })).toEqual({
      valid: true,
      settings: { balanceDate: '2026-06-30', initialBalance: -150.25 }
    });
  });

  it('accetta lo zero', () => {
    const result = validateSettingsForm({ ...valid, initialBalance: '0' });

    expect(result.valid && result.settings.initialBalance).toBe(0);
  });

  it('accetta il formato italiano e il simbolo di valuta', () => {
    const italiano = validateSettingsForm({ ...valid, initialBalance: ' € 1.234,56 ' });
    const inglese = validateSettingsForm({ ...valid, initialBalance: '1234.56' });

    expect(italiano.valid && italiano.settings.initialBalance).toBe(1234.56);
    expect(inglese.valid && inglese.settings.initialBalance).toBe(1234.56);
  });

  it('segnala entrambi gli errori insieme', () => {
    const result = validateSettingsForm({ balanceDate: '', initialBalance: 'x' });

    expect(result.valid).toBe(false);
    expect(result.valid === false && Object.keys(result.errors)).toEqual([
      'balanceDate',
      'initialBalance'
    ]);
  });
});
