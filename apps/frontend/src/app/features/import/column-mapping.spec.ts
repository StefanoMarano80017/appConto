import {
  ColumnMappingFormValue,
  ColumnMappingProposal,
  CsvAnalysis,
  boundColumns,
  formFromProposal,
  isProposalComplete,
  proposalColumns,
  sampleValue,
  unrecognizedFields,
  validateColumnMapping
} from './column-mapping';

const proposal = (overrides: Partial<ColumnMappingProposal> = {}): ColumnMappingProposal => ({
  bookingDate: 'Data contabile',
  description: 'Descrizione',
  amount: { kind: 'single', column: 'Importo' },
  typeHint: null,
  ...overrides
});

const form = (overrides: Partial<ColumnMappingFormValue> = {}): ColumnMappingFormValue => ({
  bookingDate: 'F4',
  description: 'F3',
  amountKind: 'single',
  amount: 'F2',
  debit: '',
  credit: '',
  typeHint: '',
  ...overrides
});

const analysis: CsvAnalysis = {
  headers: ['F1', 'F2', 'F3'],
  rowsRead: 2,
  proposal: proposal(),
  sample: [
    ['', '-54,30', 'SPESA SUPERMERCATO'],
    ['1', '2.450,00', 'STIPENDIO GENNAIO']
  ]
};

describe('isProposalComplete', () => {
  it('è completa quando data, descrizione e importo ci sono', () => {
    expect(isProposalComplete(proposal())).toBe(true);
  });

  it('il tipo movimento non serve a completarla', () => {
    expect(isProposalComplete(proposal({ typeHint: null }))).toBe(true);
  });

  it('non è completa se manca un campo obbligatorio', () => {
    expect(isProposalComplete(proposal({ amount: null }))).toBe(false);
    expect(isProposalComplete(proposal({ bookingDate: null }))).toBe(false);
    expect(isProposalComplete(proposal({ description: null }))).toBe(false);
  });
});

describe('unrecognizedFields', () => {
  it('elenca solo i campi obbligatori non riconosciuti', () => {
    expect(unrecognizedFields(proposal({ bookingDate: null, amount: null }))).toEqual([
      'data',
      'importo'
    ]);
  });

  it('su una proposta completa non elenca nulla', () => {
    expect(unrecognizedFields(proposal())).toEqual([]);
  });
});

describe('formFromProposal', () => {
  it('parte dalla proposta, così si corregge solo quel che serve', () => {
    expect(formFromProposal(proposal({ amount: null }))).toEqual({
      bookingDate: 'Data contabile',
      description: 'Descrizione',
      amountKind: 'single',
      amount: '',
      debit: '',
      credit: '',
      typeHint: ''
    });
  });

  it('riporta la coppia uscite/entrate riconosciuta', () => {
    const value = formFromProposal(
      proposal({ amount: { kind: 'debitCredit', debit: 'Uscite', credit: 'Entrate' } })
    );

    expect(value.amountKind).toBe('debitCredit');
    expect([value.debit, value.credit]).toEqual(['Uscite', 'Entrate']);
    expect(value.amount).toBe('');
  });
});

describe('validateColumnMapping', () => {
  it('accetta una scelta completa', () => {
    const result = validateColumnMapping(form({ typeHint: 'F1' }));

    expect(result).toEqual({
      valid: true,
      mapping: {
        bookingDate: 'F4',
        description: 'F3',
        amount: { kind: 'single', column: 'F2' },
        typeHint: 'F1'
      }
    });
  });

  it('nessuna colonna per il tipo significa nessun tipo, non un errore', () => {
    const result = validateColumnMapping(form());

    expect(result.valid).toBe(true);
    expect(result.valid && result.mapping.typeHint).toBe(null);
  });

  it('segnala le tendine lasciate vuote', () => {
    const result = validateColumnMapping(form({ bookingDate: '', description: '', amount: '' }));

    expect(result.valid).toBe(false);
    expect(result.valid === false && Object.keys(result.errors).sort()).toEqual([
      'amount',
      'bookingDate',
      'description'
    ]);
  });

  it('con uscite ed entrate separate chiede entrambe le colonne', () => {
    const result = validateColumnMapping(form({ amountKind: 'debitCredit', debit: 'F2' }));

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.amount).toContain('entrate');
  });

  it('rifiuta uscite ed entrate nella stessa colonna', () => {
    const result = validateColumnMapping(
      form({ amountKind: 'debitCredit', debit: 'F2', credit: 'F2' })
    );

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors.amount).toContain('diverse');
  });
});

describe('proposalColumns e boundColumns', () => {
  it('elenca i campi nell\'ordine in cui si leggono in tabella', () => {
    expect(boundColumns(proposalColumns(proposal({ typeHint: 'Tipo operazione' })))).toEqual([
      { label: 'Data', column: 'Data contabile' },
      { label: 'Descrizione', column: 'Descrizione' },
      { label: 'Importo', column: 'Importo' },
      { label: 'Tipo movimento', column: 'Tipo operazione' }
    ]);
  });

  it('unisce le due colonne dell\'importo in una riga leggibile', () => {
    const columns = proposalColumns(
      proposal({ amount: { kind: 'debitCredit', debit: 'Uscite', credit: 'Entrate' } })
    );

    expect(columns.amount).toBe('Uscite / Entrate');
  });

  it('non elenca i campi non riconosciuti', () => {
    const columns = boundColumns(proposalColumns(proposal({ amount: null })));

    expect(columns.map((bound) => bound.label)).toEqual(['Data', 'Descrizione']);
  });
});

describe('sampleValue', () => {
  it('dà il primo valore non vuoto della colonna', () => {
    expect(sampleValue(analysis, 'F2')).toBe('-54,30');
    expect(sampleValue(analysis, 'F1')).toBe('1');
  });

  it('su una colonna che non esiste non dà nulla', () => {
    expect(sampleValue(analysis, 'F9')).toBe('');
  });
});
