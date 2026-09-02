import type { AmountBinding, BindableField, DetectedColumns } from './column-mapping.js';
import type { CsvRow } from './csv-parser.js';
import { parseCsvAmount, parseCsvDate } from './csv-values.js';

/**
 * Riconosce quali colonne del CSV contengono i campi del dominio.
 *
 * Il criterio è il **contenuto**: una colonna i cui valori si leggono come date
 * è la data, una i cui valori si leggono come numeri è un importo, il testo
 * libero è la descrizione. Il nome dell'intestazione resta solo un indizio, per
 * sciogliere i casi ambigui (due colonne di date, importo contro saldo): così
 * lo stesso codice legge l'estratto conto di qualsiasi banca, con qualsiasi
 * numero di colonne e qualsiasi dicitura, anche in lingue che non conosciamo.
 *
 * Le colonne che non corrispondono a nessun campo noto vengono ignorate.
 *
 * Quando un campo non lo riconosce non solleva un errore: lo lascia vuoto. Un
 * rilevamento incompleto non è un guasto, è il caso in cui tocca all'utente
 * indicare le colonne — deciderlo è del servizio, non di chi rileva.
 */

/**
 * Intestazioni note, in ordine di preferenza.
 *
 * Non sono un requisito — l'import funziona anche se nessuna corrisponde — ma
 * un indizio: dicono quale colonna scegliere quando il contenuto da solo non
 * basta a decidere (`Data contabile` prima di `Data valuta`).
 */
const HEADER_HINTS: Record<BindableField, string[]> = {
  bookingDate: [
    'data contabile',
    'data operazione',
    'data movimento',
    'booking date',
    'data',
    'date',
    'data valuta',
    'value date',
  ],
  description: [
    'descrizione operazione',
    'descrizione',
    'causale',
    'description',
    'dettagli',
    'memo',
    'beneficiario',
    'nome',
  ],
  amount: ['importo', 'amount', 'valore', 'value'],
  typeHint: ['tipologia', 'tipo operazione', 'tipo movimento', 'tipo', 'type', 'categoria'],
};

/** Intestazioni che dichiarano la direzione del movimento in colonne separate. */
const DEBIT_HINTS = ['dare', 'uscite', 'uscita', 'addebiti', 'addebito', 'debito', 'debit'];
const CREDIT_HINTS = ['avere', 'entrate', 'entrata', 'accrediti', 'accredito', 'credito', 'credit'];

/** Parole con cui le banche indicano la natura del movimento. */
const TYPE_VOCABULARY = [
  'prelievo',
  'prelevamento',
  'accredito',
  'addebito',
  'bonifico',
  'pagamento',
  'versamento',
  'giroconto',
  'commissione',
  'imposta',
  'stipendio',
  'canone',
  'ricarica',
  'rimborso',
  'entrata',
  'uscita',
  'dare',
  'avere',
  'debit',
  'credit',
];

/** Righe esaminate per riconoscere il contenuto: bastano poche decine. */
const SAMPLE_SIZE = 200;

/** Quota minima di valori interpretabili perché il contenuto identifichi il campo. */
const CONTENT_THRESHOLD = 0.5;
/** Soglia più bassa per una colonna che l'intestazione dichiara già. */
const HINTED_CONTENT_THRESHOLD = 0.2;

interface ColumnProfile {
  header: string;
  /** Posizione nel file: a pari merito vince la colonna più a sinistra. */
  position: number;
  /** Valori non vuoti esaminati. */
  filled: number;
  /** Quota dei valori non vuoti che si leggono come data. */
  dateRatio: number;
  /** Quota dei valori non vuoti che si leggono come numero. */
  numberRatio: number;
  /** Valori numerici riga per riga (`null` dove la cella non è un numero). */
  numbers: (number | null)[];
  distinct: number;
  averageLength: number;
  /** Quota dei valori che contengono una parola del vocabolario dei tipi. */
  vocabularyRatio: number;
  /** Preferenza dell'intestazione per ogni campo: più basso, più preferita. */
  hintRank: Record<BindableField, number>;
  direction: 'debit' | 'credit' | null;
}

/**
 * Rende confrontabile un'intestazione: minuscole, spazi normalizzati e
 * suffissi di valuta rimossi (`Importo ( € )` e `Importo (EUR)` -> `importo`).
 */
function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[€$]/g, '')
    .replace(/\((?:\s|eur|euro)*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hintRankOf(normalized: string, aliases: string[]): number {
  const exact = aliases.indexOf(normalized);
  if (exact >= 0) {
    return exact;
  }

  // Corrispondenza parziale (`data contabile operazione`): vale meno di quella esatta.
  const partial = aliases.findIndex((alias) => normalized.includes(alias));
  return partial >= 0 ? aliases.length + partial : Number.POSITIVE_INFINITY;
}

function directionOf(normalized: string): 'debit' | 'credit' | null {
  if (DEBIT_HINTS.some((hint) => normalized.includes(hint))) {
    return 'debit';
  }

  return CREDIT_HINTS.some((hint) => normalized.includes(hint)) ? 'credit' : null;
}

function profileColumn(header: string, position: number, rows: CsvRow[]): ColumnProfile {
  const values = rows.map((row) => row[header]?.trim() ?? '');
  const filledValues = values.filter((value) => value.length > 0);
  const numbers = values.map((value) => (value.length > 0 ? parseCsvAmount(value) : null));
  const dates = filledValues.filter((value) => parseCsvDate(value) !== null).length;
  const parsedNumbers = numbers.filter((number) => number !== null).length;
  const withVocabulary = filledValues.filter((value) => {
    const lowered = value.toLowerCase();
    return TYPE_VOCABULARY.some((word) => lowered.includes(word));
  }).length;

  const filled = filledValues.length;
  const normalized = normalizeHeader(header);
  const share = (count: number): number => (filled === 0 ? 0 : count / filled);

  return {
    header,
    position,
    filled,
    dateRatio: share(dates),
    numberRatio: share(parsedNumbers),
    numbers,
    distinct: new Set(filledValues).size,
    averageLength: filled === 0 ? 0 : filledValues.reduce((sum, v) => sum + v.length, 0) / filled,
    vocabularyRatio: share(withVocabulary),
    hintRank: {
      bookingDate: hintRankOf(normalized, HEADER_HINTS.bookingDate),
      description: hintRankOf(normalized, HEADER_HINTS.description),
      amount: hintRankOf(normalized, HEADER_HINTS.amount),
      typeHint: hintRankOf(normalized, HEADER_HINTS.typeHint),
    },
    direction: directionOf(normalized),
  };
}

function isHinted(profile: ColumnProfile, field: BindableField): boolean {
  return Number.isFinite(profile.hintRank[field]);
}

/** Soglia da superare: il contenuto decide, l'intestazione la abbassa. */
function thresholdFor(profile: ColumnProfile, field: BindableField): number {
  return isHinted(profile, field) ? HINTED_CONTENT_THRESHOLD : CONTENT_THRESHOLD;
}

/**
 * Ordina le colonne candidate a un campo.
 *
 * Prima quelle che l'intestazione dichiara (nell'ordine di `HEADER_HINTS`),
 * poi quelle riconosciute dal solo contenuto, dalla più coerente alla meno.
 */
function byPreference(
  field: BindableField,
  strength: (profile: ColumnProfile) => number,
): (a: ColumnProfile, b: ColumnProfile) => number {
  return (a, b) => {
    if (a.hintRank[field] !== b.hintRank[field]) {
      return a.hintRank[field] - b.hintRank[field];
    }
    if (strength(a) !== strength(b)) {
      return strength(b) - strength(a);
    }

    return a.position - b.position;
  };
}

function pickDateColumns(profiles: ColumnProfile[]): ColumnProfile[] {
  return profiles
    .filter(
      (profile) => profile.filled > 0 && profile.dateRatio >= thresholdFor(profile, 'bookingDate'),
    )
    .sort(byPreference('bookingDate', (profile) => profile.dateRatio));
}

function pickNumericColumns(profiles: ColumnProfile[], dates: ColumnProfile[]): ColumnProfile[] {
  const isDate = new Set(dates.map((profile) => profile.header));

  return profiles
    .filter(
      (profile) =>
        profile.filled > 0 &&
        !isDate.has(profile.header) &&
        profile.numberRatio >= thresholdFor(profile, 'amount') &&
        !isCounter(profile),
    )
    .sort(byPreference('amount', (profile) => profile.numberRatio));
}

/** Numerazione progressiva (`1, 2, 3…`): un numero, ma non un importo. */
function isCounter(profile: ColumnProfile): boolean {
  const values = profile.numbers.filter((value): value is number => value !== null);
  if (values.length < 3 || !values.every((value) => Number.isInteger(value))) {
    return false;
  }

  return values.every((value, index) => {
    const previous = values[index - 1];
    return previous === undefined || value - previous === 1;
  });
}

/** Una riga "porta" un importo quando il valore c'è e non è zero. */
function carriesAmount(profile: ColumnProfile, index: number): boolean {
  return (profile.numbers[index] ?? 0) !== 0;
}

/**
 * Cerca la coppia dare/avere: due colonne numeriche che non compaiono mai
 * insieme sulla stessa riga e che insieme coprono quasi tutte le righe.
 */
function findDebitCreditPair(candidates: ColumnProfile[], rowCount: number): AmountBinding | null {
  for (const [index, first] of candidates.entries()) {
    for (const second of candidates.slice(index + 1)) {
      let both = 0;
      let either = 0;

      for (let row = 0; row < rowCount; row += 1) {
        const inFirst = carriesAmount(first, row);
        const inSecond = carriesAmount(second, row);
        if (inFirst && inSecond) {
          both += 1;
        }
        if (inFirst || inSecond) {
          either += 1;
        }
      }

      if (both === 0 && either >= rowCount * 0.8) {
        const [debit, credit] = orientPair(first, second);
        return { kind: 'debitCredit', debit: debit.header, credit: credit.header };
      }
    }
  }

  return null;
}

/** Stabilisce quale delle due colonne sono le uscite. */
function orientPair(
  first: ColumnProfile,
  second: ColumnProfile,
): [debit: ColumnProfile, credit: ColumnProfile] {
  if (first.direction !== null || second.direction !== null) {
    const debitFirst = first.direction === 'debit' || second.direction === 'credit';
    return debitFirst ? [first, second] : [second, first];
  }

  const sign = (profile: ColumnProfile): number =>
    profile.numbers.reduce<number>((total, value) => total + Math.sign(value ?? 0), 0);
  if (sign(first) < 0 !== sign(second) < 0) {
    return sign(first) < 0 ? [first, second] : [second, first];
  }

  // Ultima risorsa: in un estratto conto le uscite sono più numerose degli
  // accrediti. Se anche questa fallisce, il tipo resta correggibile a mano.
  return first.filled >= second.filled ? [first, second] : [second, first];
}

/**
 * Riconosce il saldo progressivo: colonna le cui differenze fra righe
 * consecutive coincidono coi movimenti di un'altra colonna.
 */
function isRunningBalance(candidate: ColumnProfile, movements: ColumnProfile): boolean {
  let checked = 0;
  let matching = 0;

  for (let index = 1; index < candidate.numbers.length; index += 1) {
    const previous = candidate.numbers[index - 1] ?? null;
    const current = candidate.numbers[index] ?? null;
    const movement = movements.numbers[index] ?? null;
    if (previous === null || current === null || movement === null) {
      continue;
    }

    checked += 1;
    const delta = current - previous;
    // `delta + movement`: l'estratto conto può essere ordinato dal più recente.
    if (Math.abs(delta - movement) < 0.01 || Math.abs(delta + movement) < 0.01) {
      matching += 1;
    }
  }

  return checked >= 2 && matching / checked >= 0.8;
}

function pickAmount(candidates: ColumnProfile[], rowCount: number): AmountBinding | null {
  if (candidates.length === 0) {
    return null;
  }

  const pair = findDebitCreditPair(candidates, rowCount);
  if (pair !== null) {
    return pair;
  }

  // Via i saldi progressivi: restano i movimenti.
  const movements = candidates.filter(
    (candidate) =>
      !candidates.some((other) => other !== candidate && isRunningBalance(candidate, other)),
  );

  const columns = (movements.length > 0 ? movements : candidates).map((profile) => profile.header);
  return { kind: 'single', columns };
}

function pickTypeHintColumns(texts: ColumnProfile[]): ColumnProfile[] {
  return texts
    .filter((profile) => {
      // La dicitura del tipo è una fra poche, ripetuta su molte righe: una
      // descrizione, che racconta il singolo movimento, non si ripete.
      const repeated =
        profile.distinct <= profile.filled * 0.3 && profile.vocabularyRatio >= 0.5;
      const declared = isHinted(profile, 'typeHint') && !isHinted(profile, 'description');

      return profile.averageLength <= 40 && (declared || repeated);
    })
    .sort(byPreference('typeHint', (profile) => profile.vocabularyRatio));
}

function pickDescriptionColumns(
  texts: ColumnProfile[],
  typeHints: ColumnProfile[],
): ColumnProfile[] {
  const isTypeHint = new Set(typeHints.map((profile) => profile.header));
  // Più il testo è lungo, più è una descrizione e non un'etichetta.
  const byLength = byPreference('description', (profile) => profile.averageLength);
  const free = texts.filter((profile) => !isTypeHint.has(profile.header)).sort(byLength);

  // Se il CSV ha solo colonne categoriche, la descrizione è la migliore di quelle.
  return free.length > 0 ? free : [...typeHints].sort(byLength);
}

export function detectColumns(headers: string[], rows: CsvRow[]): DetectedColumns {
  const sample = rows.slice(0, SAMPLE_SIZE);
  const profiles = headers.map((header, position) => profileColumn(header, position, sample));

  const dates = pickDateColumns(profiles);
  const numerics = pickNumericColumns(profiles, dates);

  const claimed = new Set([
    ...dates.map((profile) => profile.header),
    ...numerics.map((profile) => profile.header),
  ]);
  const texts = profiles.filter((profile) => profile.filled > 0 && !claimed.has(profile.header));
  const typeHints = pickTypeHintColumns(texts);
  const descriptions = pickDescriptionColumns(texts, typeHints);

  return {
    bookingDate: dates.map((profile) => profile.header),
    description: descriptions.map((profile) => profile.header),
    amount: pickAmount(numerics, sample.length),
    typeHint: typeHints.map((profile) => profile.header),
  };
}
