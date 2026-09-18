/**
 * Le colonne del CSV da leggere per ogni campo.
 *
 * Il backend le riconosce dal contenuto del file; quando non ci arriva — o
 * quando sbaglia — le indica l'utente. Qui c'è la forma di quella scelta e la
 * sua validazione: funzioni pure, nessuna rete e nessun segnale. L'ultima
 * parola resta del backend, che conosce il file, ma una tendina lasciata vuota
 * non deve richiedere un viaggio fino al server per essere segnalata.
 */

/** Chi decide le colonne da leggere. */
export type ImportMode = 'auto' | 'manual';

/** L'importo su una colonna sola, oppure su due mutuamente esclusive. */
export type AmountChoice =
  | { kind: 'single'; column: string }
  | { kind: 'debitCredit'; debit: string; credit: string };

/** La scelta completa, quella che il backend accetta. */
export interface ColumnMapping {
  bookingDate: string;
  description: string;
  amount: AmountChoice;
  /** `null` se il file non ha una colonna con la dicitura del movimento. */
  typeHint: string | null;
}

/** Quel che il rilevamento automatico propone: `null` dove non ha riconosciuto. */
export interface ColumnMappingProposal {
  bookingDate: string | null;
  description: string | null;
  amount: AmountChoice | null;
  typeHint: string | null;
}

/** Cosa contiene il file, prima di importarlo. */
export interface CsvAnalysis {
  headers: string[];
  rowsRead: number;
  proposal: ColumnMappingProposal;
  /** Prime righe, allineate alle intestazioni. */
  sample: string[][];
}

/** I valori del modulo manuale come stanno nelle tendine: `''` = nessuna scelta. */
export interface ColumnMappingFormValue {
  bookingDate: string;
  description: string;
  amountKind: AmountChoice['kind'];
  amount: string;
  debit: string;
  credit: string;
  typeHint: string;
}

export interface ColumnMappingErrors {
  bookingDate?: string;
  description?: string;
  amount?: string;
}

export type ColumnMappingResult =
  | { valid: true; mapping: ColumnMapping }
  | { valid: false; errors: ColumnMappingErrors };

/** I tre campi che servono per importare; il tipo movimento è facoltativo. */
export function isProposalComplete(proposal: ColumnMappingProposal): boolean {
  return (
    proposal.bookingDate !== null && proposal.description !== null && proposal.amount !== null
  );
}

/**
 * Il modulo manuale precompilato con la proposta automatica.
 *
 * Anche quando il rilevamento è incompleto vale la pena partire da qui: chi
 * deve indicare l'importo non deve reindicare la data che era già giusta.
 */
export function formFromProposal(proposal: ColumnMappingProposal): ColumnMappingFormValue {
  const amount = proposal.amount;

  return {
    bookingDate: proposal.bookingDate ?? '',
    description: proposal.description ?? '',
    amountKind: amount?.kind ?? 'single',
    amount: amount?.kind === 'single' ? amount.column : '',
    debit: amount?.kind === 'debitCredit' ? amount.debit : '',
    credit: amount?.kind === 'debitCredit' ? amount.credit : '',
    typeHint: proposal.typeHint ?? ''
  };
}

export function validateColumnMapping(form: ColumnMappingFormValue): ColumnMappingResult {
  const errors: ColumnMappingErrors = {};

  if (form.bookingDate === '') {
    errors.bookingDate = 'Indica la colonna della data.';
  }
  if (form.description === '') {
    errors.description = 'Indica la colonna della descrizione.';
  }

  const amount = amountFromForm(form);
  if (amount === null) {
    errors.amount =
      form.amountKind === 'single'
        ? "Indica la colonna dell'importo."
        : 'Indica le colonne delle uscite e delle entrate.';
  } else if (amount.kind === 'debitCredit' && amount.debit === amount.credit) {
    errors.amount = 'Uscite ed entrate devono stare in due colonne diverse.';
  }

  if (amount === null || Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    mapping: {
      bookingDate: form.bookingDate,
      description: form.description,
      amount,
      typeHint: form.typeHint === '' ? null : form.typeHint
    }
  };
}

function amountFromForm(form: ColumnMappingFormValue): AmountChoice | null {
  if (form.amountKind === 'single') {
    return form.amount === '' ? null : { kind: 'single', column: form.amount };
  }

  return form.debit === '' || form.credit === ''
    ? null
    : { kind: 'debitCredit', debit: form.debit, credit: form.credit };
}

/**
 * Le colonne che l'import ha usato, come le riporta il backend.
 *
 * Con le uscite e le entrate su due colonne, `amount` le riporta entrambe
 * (`Uscite / Entrate`): è un'informazione da leggere, non da rimettere in una
 * tendina.
 */
export type BoundColumns = Record<keyof ColumnMappingProposal, string | null>;

/** Una colonna del file e il campo per cui è stata usata. */
export interface BoundColumn {
  /** Campo del dominio. */
  label: string;
  /** Intestazione della colonna nel file caricato. */
  column: string;
}

const FIELD_LABELS: [field: keyof BoundColumns, label: string][] = [
  ['bookingDate', 'Data'],
  ['description', 'Descrizione'],
  ['amount', 'Importo'],
  ['typeHint', 'Tipo movimento']
];

/**
 * Le colonne usate, in forma leggibile.
 *
 * Il riconoscimento avviene sul contenuto e non sul nome dell'intestazione:
 * mostrarlo è il modo per verificarlo senza fidarsi. I campi che il file non
 * conteneva non vengono elencati.
 */
export function boundColumns(columns: BoundColumns): BoundColumn[] {
  return FIELD_LABELS.flatMap(([field, label]) => {
    const column = columns[field];

    return column === null ? [] : [{ label, column }];
  });
}

/** La proposta in forma leggibile, la stessa delle colonne usate dall'import. */
export function proposalColumns(proposal: ColumnMappingProposal): BoundColumns {
  const amount = proposal.amount;

  return {
    bookingDate: proposal.bookingDate,
    description: proposal.description,
    amount:
      amount === null
        ? null
        : amount.kind === 'single'
          ? amount.column
          : `${amount.debit} / ${amount.credit}`,
    typeHint: proposal.typeHint
  };
}

/**
 * I campi obbligatori che il rilevamento non ha riconosciuto.
 *
 * Sono il motivo per cui la modalità manuale esiste: dirli per nome è il primo
 * passo per farli indicare.
 */
export function unrecognizedFields(proposal: ColumnMappingProposal): string[] {
  const columns = proposalColumns(proposal);

  return FIELD_LABELS.filter(
    ([field]) => field !== 'typeHint' && columns[field] === null
  ).map(([, label]) => label.toLowerCase());
}

/**
 * Un valore d'esempio per la colonna, preso dalle prime righe del file.
 *
 * È quello che permette di riconoscere la colonna giusta quando
 * l'intestazione non dice niente (`F3`, `Column2`): si guarda cosa contiene.
 */
export function sampleValue(analysis: CsvAnalysis, column: string): string {
  const index = analysis.headers.indexOf(column);
  if (index < 0) {
    return '';
  }

  return analysis.sample.map((row) => row[index] ?? '').find((value) => value !== '') ?? '';
}
