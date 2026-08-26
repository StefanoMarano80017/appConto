import {
  LoanFormValue,
  RepaymentFormValue,
  validateLoanForm,
  validateRepaymentForm
} from './loan-form';

const loanForm = (overrides: Partial<LoanFormValue> = {}): LoanFormValue => ({
  borrowerName: 'Mamma',
  description: 'Acquisto fatto per lei',
  amount: '80,00',
  lentAt: '2026-08-10',
  ...overrides
});

const repaymentForm = (overrides: Partial<RepaymentFormValue> = {}): RepaymentFormValue => ({
  amount: '30,00',
  repaymentDate: '2026-08-20',
  note: '',
  transactionId: '',
  ...overrides
});

describe('validateLoanForm', () => {
  it('accetta un prestito completo, leggendo la virgola come decimale', () => {
    const result = validateLoanForm(loanForm());

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.loan).toEqual({
        borrowerName: 'Mamma',
        description: 'Acquisto fatto per lei',
        amount: 80,
        lentAt: '2026-08-10'
      });
    }
  });

  it('una descrizione vuota è assenza di descrizione, non stringa vuota', () => {
    const result = validateLoanForm(loanForm({ description: '   ' }));

    expect(result.valid && result.loan.description).toBeNull();
  });

  it('la persona è obbligatoria', () => {
    const result = validateLoanForm(loanForm({ borrowerName: '  ' }));

    expect(result.valid).toBe(false);
    expect(!result.valid && result.errors.borrowerName).toBeDefined();
  });

  it('l\'importo deve essere positivo', () => {
    for (const amount of ['0', '-80', 'abc', '']) {
      const result = validateLoanForm(loanForm({ amount }));

      expect(result.valid).toBe(false);
      expect(!result.valid && result.errors.amount).toBeDefined();
    }
  });

  it('l\'importo non può superare quello del movimento', () => {
    const result = validateLoanForm(loanForm({ amount: '100' }), 80);

    expect(result.valid).toBe(false);
    expect(!result.valid && result.errors.amount).toContain('80,00');
  });

  it('ma può esserne una parte: lo stesso movimento può finanziare più prestiti', () => {
    expect(validateLoanForm(loanForm({ amount: '50' }), 80).valid).toBe(true);
    expect(validateLoanForm(loanForm({ amount: '80' }), 80).valid).toBe(true);
  });

  it('la data deve essere una data', () => {
    const result = validateLoanForm(loanForm({ lentAt: '10/08/2026' }));

    expect(result.valid).toBe(false);
    expect(!result.valid && result.errors.lentAt).toBeDefined();
  });
});

describe('validateRepaymentForm', () => {
  it('senza movimento collegato la restituzione è in contanti', () => {
    const result = validateRepaymentForm(repaymentForm(), 80);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.repayment).toEqual({
        amount: 30,
        repaymentDate: '2026-08-20',
        note: null,
        transactionId: null
      });
    }
  });

  it('con un movimento scelto conserva il collegamento', () => {
    const result = validateRepaymentForm(
      repaymentForm({ transactionId: 't-1', note: 'bonifico' }),
      80
    );

    expect(result.valid && result.repayment.transactionId).toBe('t-1');
    expect(result.valid && result.repayment.note).toBe('bonifico');
  });

  it('non può superare il credito residuo', () => {
    const result = validateRepaymentForm(repaymentForm({ amount: '40' }), 30);

    expect(result.valid).toBe(false);
    expect(!result.valid && result.errors.amount).toContain('30,00');
  });

  it('la restituzione esatta del residuo è ammessa', () => {
    expect(validateRepaymentForm(repaymentForm({ amount: '30' }), 30).valid).toBe(true);
  });

  it('su un prestito già chiuso non è ammessa', () => {
    const result = validateRepaymentForm(repaymentForm({ amount: '1' }), 0);

    expect(result.valid).toBe(false);
    expect(!result.valid && result.errors.amount).toContain('già stato restituito');
  });

  it('l\'importo deve essere positivo', () => {
    for (const amount of ['0', '-30', 'abc', '']) {
      expect(validateRepaymentForm(repaymentForm({ amount }), 80).valid).toBe(false);
    }
  });
});
