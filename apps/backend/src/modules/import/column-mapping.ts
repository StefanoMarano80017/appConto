import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';

/**
 * Quali colonne del CSV leggere per ogni campo del dominio.
 *
 * Il binding può arrivare da due strade che qui si incontrano:
 *
 *   automatica  `csv-column-detector` guarda i valori e propone le colonne;
 *   manuale     l'utente le indica, quando il rilevamento non ci arriva.
 *
 * Il resto della pipeline non sa quale delle due è stata usata: riceve un
 * `ColumnBinding` completo e legge le righe.
 */

export type BindableField = 'bookingDate' | 'description' | 'amount' | 'typeHint';

/**
 * Come si ottiene l'importo di una riga.
 *
 * `single`: una sola colonna, col segno che porta (le colonne successive
 * servono da riserva quando la prima è vuota).
 * `debitCredit`: due colonne mutuamente esclusive (`Dare`/`Avere`,
 * `Uscite`/`Entrate`), il segno lo dà la colonna in cui compare il valore.
 */
export type AmountBinding =
  | { kind: 'single'; columns: string[] }
  | { kind: 'debitCredit'; debit: string; credit: string };

/**
 * Binding completo: i tre campi obbligatori ci sono.
 *
 * Le liste sono in ordine di preferenza e non sono mai vuote — a garantirlo
 * sono le due sole funzioni che costruiscono un binding, qui sotto.
 */
export interface ColumnBinding {
  bookingDate: string[];
  description: string[];
  amount: AmountBinding;
  /** Vuoto se il file non ha una colonna con la dicitura del movimento. */
  typeHint: string[];
}

/** Esito del rilevamento automatico: vuoto dove non ha riconosciuto nulla. */
export interface DetectedColumns {
  bookingDate: string[];
  description: string[];
  amount: AmountBinding | null;
  typeHint: string[];
}

/** Nomi dei campi come li legge l'utente nei messaggi. */
const FIELD_LABELS: Record<BindableField, string> = {
  bookingDate: 'data',
  description: 'descrizione',
  amount: 'importo',
  typeHint: 'tipo movimento',
};

const columnName = z
  .string({ error: 'Colonna non indicata' })
  .trim()
  .min(1, { error: 'Colonna non indicata' });

/** La scelta manuale dell'utente: una colonna per campo. */
export const columnMappingSchema = z.object(
  {
    bookingDate: columnName,
    description: columnName,
    amount: z.discriminatedUnion(
      'kind',
      [
        z.object({ kind: z.literal('single'), column: columnName }),
        z.object({
          kind: z.literal('debitCredit'),
          debit: columnName,
          credit: columnName,
        }),
      ],
      { error: "Colonna dell'importo non indicata" },
    ),
    /** Assente o `null` quando il file non ha la dicitura del movimento. */
    typeHint: columnName.nullish().transform((column) => column ?? null),
  },
  { error: 'Colonne da usare non indicate' },
);

export type ColumnMapping = z.infer<typeof columnMappingSchema>;

/**
 * La proposta del rilevamento automatico, nella forma della scelta manuale.
 *
 * Stessa forma perché la modalità manuale parte da qui: l'utente corregge una
 * proposta invece di riempire tendine vuote.
 */
export interface ColumnMappingProposal {
  bookingDate: string | null;
  description: string | null;
  amount: ColumnMapping['amount'] | null;
  typeHint: string | null;
}

/** Richiesta di import con le colonne indicate a mano. */
export const mappedImportSchema = z.object({
  content: z.string({ error: 'Contenuto del CSV mancante' }),
  mapping: columnMappingSchema,
});

/** I campi obbligatori che il rilevamento automatico non ha riconosciuto. */
export function unrecognizedFields(detected: DetectedColumns): BindableField[] {
  const candidates: [BindableField, boolean][] = [
    ['bookingDate', detected.bookingDate.length === 0],
    ['description', detected.description.length === 0],
    ['amount', detected.amount === null],
  ];

  return candidates.filter(([, missing]) => missing).map(([field]) => field);
}

/**
 * Il binding proposto dal rilevamento automatico.
 *
 * Se un campo obbligatorio manca non c'è niente da inventare: il messaggio
 * elenca cosa non è stato riconosciuto e indirizza alla modalità manuale, che
 * è la risposta a questo caso.
 */
export function bindingFromDetection(
  detected: DetectedColumns,
  headers: string[],
): ColumnBinding {
  const missing = unrecognizedFields(detected);

  if (detected.amount === null || missing.length > 0) {
    const fields = missing.map((field) => FIELD_LABELS[field]).join(', ');

    throw new ValidationError(
      `Non è stato possibile riconoscere nel CSV le colonne: ${fields}. ` +
        `Indica le colonne manualmente. Intestazioni presenti: ${headers.join(', ')}.`,
    );
  }

  return {
    bookingDate: detected.bookingDate,
    description: detected.description,
    amount: detected.amount,
    typeHint: detected.typeHint,
  };
}

/**
 * Il binding scelto dall'utente.
 *
 * Si controlla solo che le colonne esistano nel file e che le due colonne
 * dare/avere siano distinte: il resto è una sua decisione, e se una colonna
 * non contiene quel che credeva lo dicono gli errori riga per riga.
 */
export function bindingFromMapping(mapping: ColumnMapping, headers: string[]): ColumnBinding {
  const known = new Set(headers);
  const existing = (column: string, field: BindableField): string => {
    if (!known.has(column)) {
      throw new ValidationError(
        `La colonna "${column}", indicata per la ${FIELD_LABELS[field]}, non esiste nel CSV. ` +
          `Intestazioni presenti: ${headers.join(', ')}.`,
      );
    }

    return column;
  };

  if (mapping.amount.kind === 'debitCredit' && mapping.amount.debit === mapping.amount.credit) {
    throw new ValidationError(
      'Le uscite e le entrate non possono stare nella stessa colonna: scegline due diverse, ' +
        "oppure indica una sola colonna per l'importo.",
    );
  }

  return {
    bookingDate: [existing(mapping.bookingDate, 'bookingDate')],
    description: [existing(mapping.description, 'description')],
    amount:
      mapping.amount.kind === 'single'
        ? { kind: 'single', columns: [existing(mapping.amount.column, 'amount')] }
        : {
            kind: 'debitCredit',
            debit: existing(mapping.amount.debit, 'amount'),
            credit: existing(mapping.amount.credit, 'amount'),
          },
    typeHint: mapping.typeHint === null ? [] : [existing(mapping.typeHint, 'typeHint')],
  };
}

/** La proposta del rilevamento, da mostrare e da correggere. */
export function toProposal(detected: DetectedColumns): ColumnMappingProposal {
  return {
    bookingDate: detected.bookingDate[0] ?? null,
    description: detected.description[0] ?? null,
    amount: proposedAmount(detected.amount),
    typeHint: detected.typeHint[0] ?? null,
  };
}

/** Della riserva (le colonne oltre la prima) la scelta manuale non sa nulla. */
function proposedAmount(amount: AmountBinding | null): ColumnMapping['amount'] | null {
  if (amount === null) {
    return null;
  }
  if (amount.kind === 'debitCredit') {
    return { kind: 'debitCredit', debit: amount.debit, credit: amount.credit };
  }

  const column = amount.columns[0];
  return column === undefined ? null : { kind: 'single', column };
}

/** Descrive all'utente le colonne usate, che così può verificarle. */
export function describeBinding(binding: ColumnBinding): Record<BindableField, string | null> {
  return {
    bookingDate: binding.bookingDate[0] ?? null,
    description: binding.description[0] ?? null,
    amount:
      binding.amount.kind === 'single'
        ? (binding.amount.columns[0] ?? null)
        : `${binding.amount.debit} / ${binding.amount.credit}`,
    typeHint: binding.typeHint[0] ?? null,
  };
}
